import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WorkflowService } from "../src/service.js";
import { RunController } from "../src/run-controller.js";
import type { PreparedExecution } from "../src/execution-types.js";
import type { Node } from "../src/graph.js";
import { continuationKind, parseContinuationRequest } from "../src/lineage.js";

const models = [{ provider: "test", id: "frozen", thinkingLevels: ["off"] as const }];

async function author(s: WorkflowService, id: string, nodes: Node[]) {
  await s.dispatch("workflow.create", { id, name: id });
  await s.dispatch("workflow.patch", { id, expectedRevision: 1, operations: [
    ...nodes.map(node => ({ op: "addNode", graphId: "main", node })),
    ...nodes.slice(1).map((node, i) => ({ op: "connect", graphId: "main", edge: { from: nodes[i]!.id, to: node.id } })),
  ] });
}

async function wait(c: RunController, id: string, status: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const run = c.observe(id).run;
    if (run.status === status) return run;
    if (["failed", "cancelled"].includes(run.status) && status !== run.status) throw new Error(run.error ?? run.status);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${status}: ${run.status}`);
    await sleep(40);
  }
}

async function fixture(work: (s: WorkflowService, c: RunController, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-b02-"));
  const filename = join(directory, "state.sqlite");
  const s = new WorkflowService(filename, { cwd: directory, availableModels: models });
  const c = new RunController(filename);
  try { await work(s, c, directory); }
  finally {
    for (const run of c.store.listRuns()) {
      try { await c.control(run.id, "cancel"); } catch { /* replaced lineage may refuse resume-like paths */ }
      const deadline = Date.now() + 8_000;
      while (!["succeeded", "failed", "cancelled", "paused"].includes(c.observe(run.id).run.status) && Date.now() < deadline) await sleep(40);
    }
    s.close(); c.close(); await rm(directory, { recursive: true, force: true });
  }
}

async function seedQueuedSuccessor(
  s: WorkflowService,
  c: RunController,
  directory: string,
  ids: { sourceWorkflow: string; targetWorkflow: string; sourceKey: string; continueKey: string; targetRunId: string },
) {
  await writeFile(join(directory, "reviewed-input.txt"), "inspected version");
  await author(s, ids.sourceWorkflow, [{ id: "done", kind: "end", value: { op: "literal", value: { accepted: true } } }]);
  const sourcePlan = await s.dispatch("workflow.prepare", { id: ids.sourceWorkflow }) as PreparedExecution;
  const source = await s.dispatch("run.start", { preparedId: sourcePlan.preparedId, idempotencyKey: ids.sourceKey, input: null }) as { id: string };
  await wait(c, source.id, "succeeded");
  await author(s, ids.targetWorkflow, [
    { id: "write", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('WRITER_RAN','gap-writer')"] },
    { id: "done", kind: "end", value: { op: "literal", value: { accepted: true } } },
  ]);
  const targetPlan = await s.dispatch("workflow.prepare", { id: ids.targetWorkflow }) as PreparedExecution;
  const inspect = await s.dispatch("run.continuation.inspect", { id: source.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; blockers: unknown[] };
  assert.equal(inspect.blockers.length, 0);
  const body = {
    preparedId: targetPlan.preparedId, idempotencyKey: ids.continueKey,
    source: { runId: source.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "qa", reason: "queued create-gap", evidence: ["files inspected"], input: null, reuse: [],
    workspaceDigest: inspect.workspace.digest,
  };
  const parsed = parseContinuationRequest(body);
  const created = c.store.createContinuation({
    id: ids.targetRunId, plan: targetPlan.plan, cwd: targetPlan.cwd,
    start: { preparedId: parsed.preparedId, idempotencyKey: parsed.idempotencyKey, operation: continuationKind },
    request: parsed, reused: [], paused: false,
  });
  assert.equal(created.id, ids.targetRunId);
  assert.equal(created.status, "queued");
  assert.equal(created.desired, "running");
  return { source, body };
}

test("queued continue redelivery after create-gap returns the same run without rereading workspace", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  const { source, body } = await seedQueuedSuccessor(s, c, directory, {
    sourceWorkflow: "gapSource", targetWorkflow: "gapTarget", sourceKey: "gap-src", continueKey: "gap-cont", targetRunId: "run-gap-tgt",
  });
  await writeFile(join(directory, "reviewed-input.txt"), "changed AFTER continuation receipt but BEFORE first admission");
  const redelivered = await s.dispatch("run.continue", body) as { id: string; status: string; desired: string };
  assert.equal(redelivered.id, "run-gap-tgt");
  assert.equal(redelivered.status, "queued");
  assert.equal(redelivered.desired, "running");
  assert.equal(c.store.get("run-gap-tgt").ownerToken, null);
  assert.equal(c.store.listActivations("run-gap-tgt").length, 0);
  assert.equal(c.store.fence(source.id)?.successorRunId, "run-gap-tgt");
  assert.equal(c.store.listRuns().length, 2);
  await assert.rejects(s.dispatch("run.continue", { ...body, idempotencyKey: "gap-cont-other" }), /successor-admitted|already has an admitted/);
  await assert.rejects(s.dispatch("run.resume", { id: "run-gap-tgt" }), /workspace|digest|files.*changed|changed.*files/i);
  const again = await s.dispatch("run.continue", body) as { id: string; status: string };
  assert.equal(again.id, "run-gap-tgt");
  assert.equal(again.status, "queued");
  await assert.rejects(readFile(join(directory, "WRITER_RAN"), "utf8"), /ENOENT/);
}));

test("queued continue redelivery without file change does not auto-launch; resume is first admission", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  const { body } = await seedQueuedSuccessor(s, c, directory, {
    sourceWorkflow: "gapSource2", targetWorkflow: "gapTarget2", sourceKey: "gap-src-2", continueKey: "gap-cont-2", targetRunId: "run-gap-tgt2",
  });
  const redelivered = await s.dispatch("run.continue", body) as { id: string; status: string };
  assert.equal(redelivered.id, "run-gap-tgt2");
  assert.equal(redelivered.status, "queued");
  assert.equal(c.store.get("run-gap-tgt2").ownerToken, null);
  assert.equal(c.store.listActivations("run-gap-tgt2").length, 0);
  await assert.rejects(readFile(join(directory, "WRITER_RAN"), "utf8"), /ENOENT/);
  await s.dispatch("run.resume", { id: "run-gap-tgt2" });
  await wait(c, "run-gap-tgt2", "succeeded");
  assert.equal(await readFile(join(directory, "WRITER_RAN"), "utf8"), "gap-writer");
}));
