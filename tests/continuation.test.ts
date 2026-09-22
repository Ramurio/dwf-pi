import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WorkflowService, publicRunSummary, serviceToolNames } from "../src/service.js";
import { RunController } from "../src/run-controller.js";
import { RunStore, activationKey } from "../src/run-store.js";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
import { executionFailure } from "../src/execution-failure.js";
import type { PreparedExecution } from "../src/execution-types.js";
import type { Node, WorkflowDefinition } from "../src/graph.js";
import { graphSnapshot } from "../src/graph-view/model.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { GitWorkspaces } from "../src/workspaces.js";
import { digestJson } from "../src/lineage.js";

const models = [{ provider: "test", id: "frozen", thinkingLevels: ["off"] as const }];
const done: Node = { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "plan"] } };
const planNode: Node = { id: "plan", kind: "transform", value: { op: "literal", value: { result: "plan-v1" } } };
const reuseNode: Node = { id: "prior", kind: "reuse", bindingId: "planner", outputSchema: { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false } };
const writeOk: Node = { id: "write", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').appendFileSync('effects','continued\\n')"] };
const writeFail: Node = { id: "write", kind: "check", command: "/dynamicwf-missing-command", args: [] };

async function author(s: WorkflowService, id: string, nodes: Node[], edges?: { from: string; to: string }[]) {
  await s.dispatch("workflow.create", { id, name: id });
  await s.dispatch("workflow.patch", { id, expectedRevision: 1, operations: [
    ...nodes.map(node => ({ op: "addNode", graphId: "main", node })),
    ...(edges ?? nodes.slice(1).map((node, i) => ({ from: nodes[i]!.id, to: node.id }))).map(edge => ({ op: "connect", graphId: "main", edge })),
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
async function fixture(work: (s: WorkflowService, c: RunController, directory: string, filename: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-cont-")), filename = join(directory, "state.sqlite");
  const s = new WorkflowService(filename, { cwd: directory, availableModels: models }), c = new RunController(filename);
  try { await work(s, c, directory, filename); }
  finally {
    for (const run of c.store.listRuns()) {
      try { await c.control(run.id, "cancel"); } catch { /* replaced lineage may refuse resume-like paths */ }
      const deadline = Date.now() + 8_000;
      while (!["succeeded", "failed", "cancelled", "paused"].includes(c.observe(run.id).run.status) && Date.now() < deadline) await sleep(40);
    }
    s.close(); c.close(); await rm(directory, { recursive: true, force: true });
  }
}

test("service advertises continuation tools and MCP names cover them", () => {
  for (const name of ["run.continuation.inspect", "run.continue", "task.inspect", "task.usage"]) assert.ok(serviceToolNames.includes(name as never));
  assert.deepEqual(mcpToolDefinitions.map(tool => tool.serviceTool), [...serviceToolNames]);
});

test("ordinary start creates a task; unlinked historical rows stay unlinked", async () => fixture(async (s, c, directory, filename) => {
  await author(s, "sample", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
  const run = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "orig", input: null }) as { id: string };
  await wait(c, run.id, "succeeded");
  const observed = await s.dispatch("run.inspect", { id: run.id }) as { lineage?: { taskId: string; role: string; launchedWithTask: boolean } };
  assert.equal(observed.lineage?.role, "root");
  assert.equal(observed.lineage?.launchedWithTask, true);
  const injection = new DatabaseSync(filename);
  try {
    injection.prepare("DELETE FROM workflow_task_membership WHERE run_id=?").run(run.id);
    injection.prepare("DELETE FROM workflow_tasks").run();
  } finally { injection.close(); }
  const other = new RunStore(filename);
  try {
    assert.equal(other.get(run.id).lineage, undefined);
    assert.throws(() => other.task("task-missing"), /not found/);
  } finally { other.close(); }
}));

test("accepted continuation with reuse cannot be saved as a standalone preset", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  await author(s, "source", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "source" }) as PreparedExecution;
  const source = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "preset-source", input: null }) as { id: string };
  await wait(c, source.id, "succeeded");
  const inspected = await s.dispatch("run.continuation.inspect", { id: source.id }) as {
    checkpoint: string; planHash: string; workspace: { digest: string }; blockers: unknown[];
  };
  assert.deepEqual(inspected.blockers, []);
  await author(s, "reuse-preset", [reuseNode, { id: "done", kind: "finish", decision: "accepted",
    reason: { op: "literal", value: "Проверочный результат принят" }, evidence: { op: "literal", value: [] },
    value: { op: "ref", path: ["nodes", "prior"] } }]);
  const next = await s.dispatch("workflow.prepare", { id: "reuse-preset" }) as PreparedExecution;
  const continued = await s.dispatch("run.continue", {
    preparedId: next.preparedId, idempotencyKey: "preset-continuation", input: null,
    source: { runId: source.id, checkpoint: inspected.checkpoint, planHash: inspected.planHash },
    workspaceDigest: inspected.workspace.digest, actor: "tester", reason: "Проверка повторного использования", evidence: ["Исходный выход проверен"],
    reuse: [{ bindingId: "planner", sourceRunId: source.id, attempt: 1,
      activationKey: activationKey({ scope: ["graph", "main"], graphId: "main", nodeId: "plan", visit: 0 }) }],
  }) as { id: string };
  const finished = await wait(c, continued.id, "succeeded");
  assert.equal(finished.taskOutcome?.decision, "accepted");
  await assert.rejects(s.dispatch("preset.save", { id: continued.id, name: "unusable", scope: "global" }), /reuse.*run\.continue/);
  await assert.rejects(readFile(join(directory, "presets", "unusable", `${finished.plan.hash}.json`)), { code: "ENOENT" });
  assert.equal(c.store.receiptForTarget(continued.id)?.reused.length, 1);
}));

test("continue reuses a succeeded planner output, does not replay the writer, and reports the new run id", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  await author(s, "original", [planNode, writeFail, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "plan"] } }]);
  const originalPrepared = await s.dispatch("workflow.prepare", { id: "original" }) as PreparedExecution;
  const original = await s.dispatch("run.start", { preparedId: originalPrepared.preparedId, idempotencyKey: "orig-fail", input: null }) as { id: string };
  await wait(c, original.id, "failed");
  const planKey = activationKey({ scope: ["graph", "main"], graphId: "main", nodeId: "plan", visit: 0 });
  const planOut = () => c.store.getActivation(original.id, planKey)?.output as { result?: string } | undefined;
  assert.equal(planOut()?.result, "plan-v1");
  const sourceEvents = c.store.events(original.id).length;
  const inspect = await s.dispatch("run.continuation.inspect", { id: original.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; blockers: unknown[]; reusable: { key: string; attempt: number }[] };
  assert.equal(inspect.blockers.length, 0);
  assert.ok(inspect.reusable.some(item => item.key === planKey));
  await author(s, "revised", [reuseNode, writeOk, { id: "done", kind: "end", value: { op: "object", fields: { prior: { op: "ref", path: ["nodes", "prior"] }, wrote: { op: "ref", path: ["nodes", "write"] } } } }]);
  const revised = await s.dispatch("workflow.prepare", { id: "revised" }) as PreparedExecution;
  await assert.rejects(s.dispatch("run.start", { preparedId: revised.preparedId, idempotencyKey: "must-continue", input: null }), /continuation receipt/);
  const continued = await s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "rev-1", input: { from: "continuation" },
    source: { runId: original.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "tester", reason: "Reuse the planner and write with a new check", evidence: ["original planner output inspected"],
    workspaceDigest: inspect.workspace.digest,
    reuse: [{ bindingId: "planner", sourceRunId: original.id, activationKey: planKey, attempt: 1 }],
  }) as { id: string; status: string };
  assert.match(continued.id, /^run-/);
  assert.notEqual(continued.id, original.id);
  const finished = await wait(c, continued.id, "succeeded");
  assert.equal((finished.output as { prior: { result: string } }).prior.result, "plan-v1");
  assert.equal(await readFile(join(directory, "effects"), "utf8"), "continued\n");
  assert.equal(planOut()?.result, "plan-v1");
  assert.equal(c.store.events(original.id).filter(event => event.type === "activation.started" && (event.payload as { kind?: string }).kind === "transform").length, 1);
  assert.ok(c.store.events(original.id).length >= sourceEvents);
  const reuseAct = c.store.listActivations(continued.id).find(item => item.kind === "reuse");
  assert.equal(reuseAct?.status, "succeeded");
  assert.equal(reuseAct?.metadata.reused && (reuseAct.metadata.reused as { invocation?: boolean }).invocation, false);
  assert.equal(c.store.listActivations(continued.id).some(item => item.kind === "agent"), false);
  const task = await s.dispatch("task.inspect", { id: finished.lineage!.taskId }) as { members: { runId: string; role: string; launchedWithTask: boolean }[]; receipts: { reused: { bindingId: string }[] }[] };
  assert.equal(task.members.length, 2);
  assert.equal(task.members.find(member => member.runId === original.id)?.launchedWithTask, true);
  assert.equal(task.receipts.at(0)?.reused.at(0)?.bindingId, "planner");
  const originalAfter = c.store.get(original.id);
  assert.equal(originalAfter.status, "failed");
  assert.equal(originalAfter.lineage?.successorRunId, continued.id);
}));

test("exact continue redelivery returns the same run before rereading the workspace", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  await author(s, "sample", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
  const original = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "o", input: { z: 1 } }) as { id: string };
  await wait(c, original.id, "succeeded");
  await author(s, "next", [{ id: "done", kind: "end", value: { op: "ref", path: ["input"] } }]);
  const next = await s.dispatch("workflow.prepare", { id: "next" }) as PreparedExecution;
  const inspect = await s.dispatch("run.continuation.inspect", { id: original.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
  const request = {
    preparedId: next.preparedId, idempotencyKey: "same-continue", input: { z: 1 },
    source: { runId: original.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "tester", reason: "no-reuse revision", evidence: ["ok"], workspaceDigest: inspect.workspace.digest, reuse: [],
  };
  const first = await s.dispatch("run.continue", request) as { id: string };
  await wait(c, first.id, "succeeded");
  const again = await s.dispatch("run.continue", { ...request, input: { z: 1 } }) as { id: string; status: string };
  assert.equal(again.id, first.id);
  const beforeReplay = c.store.events(original.id);
  const sourceAgain = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "o", input: { z: 1 } }) as { id: string };
  assert.equal(sourceAgain.id, original.id);
  assert.deepEqual(c.store.events(original.id), beforeReplay);
  await assert.rejects(c.control(original.id, "resume"), /continuation/);
  await assert.rejects(s.dispatch("run.continue", { ...request, reason: "changed" }), /idempotency conflict/);
  await assert.rejects(s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "same-continue", input: { z: 1 } }), /operation/);
}));

test("stale checkpoint, missing source, duplicate bindings, wrong schema, cycles and grafts are rejected without orphans", async () => fixture(async (s, c, directory, filename) => {
  await author(s, "a", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "a" }) as PreparedExecution;
  const runA = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "a1", input: null }) as { id: string };
  await wait(c, runA.id, "succeeded");
  const runB = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "b1", input: { other: true } }) as { id: string };
  await wait(c, runB.id, "succeeded");
  await author(s, "rev", [reuseNode, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const revised = await s.dispatch("workflow.prepare", { id: "rev" }) as PreparedExecution;
  const inspect = await s.dispatch("run.continuation.inspect", { id: runA.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
  const planKey = activationKey({ scope: ["graph", "main"], graphId: "main", nodeId: "plan", visit: 0 });
  const validReuse = [{ bindingId: "planner", sourceRunId: runA.id, activationKey: planKey, attempt: 1 }];
  await assert.rejects(s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "stale", input: null, actor: "t", reason: "x", evidence: ["e"],
    source: { runId: runA.id, checkpoint: "c".repeat(64), planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest, reuse: validReuse,
  }), /checkpoint|changed/);
  await assert.rejects(s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "missing", input: null, actor: "t", reason: "x", evidence: ["e"],
    source: { runId: "run-missing", checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest, reuse: validReuse,
  }), /not found|Missing/);
  await assert.rejects(s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "graft", input: null, actor: "t", reason: "x", evidence: ["e"],
    source: { runId: runA.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest,
    reuse: [{ bindingId: "planner", sourceRunId: runB.id, activationKey: planKey, attempt: 1 }],
  }), /ancestor/);
  await assert.rejects(s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "dup", input: null, actor: "t", reason: "x", evidence: ["e"],
    source: { runId: runA.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest,
    reuse: [validReuse[0]!, validReuse[0]!],
  }), /Duplicate|exactly/);
  const failedKey = activationKey({ scope: ["graph", "main"], graphId: "main", nodeId: "plan", visit: 0 });
  await assert.rejects(s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "attempt", input: null, actor: "t", reason: "x", evidence: ["e"],
    source: { runId: runA.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest,
    reuse: [{ bindingId: "planner", sourceRunId: runA.id, activationKey: failedKey, attempt: 99 }],
  }), /Stale reuse attempt/);
  const injection = new DatabaseSync(filename);
  try {
    injection.exec("CREATE TRIGGER reject_cont BEFORE INSERT ON workflow_run_events WHEN NEW.type='continuation.fenced' BEGIN SELECT RAISE(ABORT,'injected continuation failure'); END");
  } finally { injection.close(); }
  const before = c.store.listRuns().length;
  await assert.rejects(s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "rollback", input: null, actor: "t", reason: "x", evidence: ["e"],
    source: { runId: runA.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest, reuse: validReuse,
  }), /injected continuation failure/);
  assert.equal(c.store.listRuns().length, before);
  assert.equal(c.store.fence(runA.id), undefined);
}));

test("active owner, admitted successor, paused successor and resume fence", async () => fixture(async (s, c, directory) => {
  await author(s, "sample", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
  const paused = c.store.create({ id: "run-paused-src", plan: prepared.plan, input: null, cwd: prepared.cwd, start: { preparedId: prepared.preparedId, idempotencyKey: "paused-src" } });
  c.store.requestControl(paused.id, "pause");
  const inspect = await s.dispatch("run.continuation.inspect", { id: paused.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; blockers: { code: string }[] };
  assert.equal(inspect.blockers.length, 0);
  await author(s, "next", [{ id: "done", kind: "end", value: { op: "literal", value: { result: "next" } } }]);
  const next = await s.dispatch("workflow.prepare", { id: "next" }) as PreparedExecution;
  const successor = await s.dispatch("run.continue", {
    preparedId: next.preparedId, idempotencyKey: "from-paused", input: null, actor: "t", reason: "keep pause", evidence: ["paused source"],
    source: { runId: paused.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest, reuse: [],
  }) as { id: string; status: string; desired: string };
  assert.equal(successor.status, "paused");
  assert.equal(successor.desired, "paused");
  assert.equal(c.store.get(paused.id).status, "paused");
  await assert.rejects(c.control(paused.id, "resume"), /replaced by a continuation/);
  const live = c.store.create({ id: "run-live", plan: prepared.plan, input: null, cwd: prepared.cwd, start: { preparedId: prepared.preparedId, idempotencyKey: "live" } });
  c.store.reserveLaunch(live.id);
  const blocked = await s.dispatch("run.continuation.inspect", { id: live.id }) as { blockers: { code: string }[] };
  assert.ok(blocked.blockers.some(item => item.code === "live-owner" || item.code === "live-processes"));
  const inspectPaused = await s.dispatch("run.continuation.inspect", { id: paused.id }) as { blockers: { code: string }[] };
  assert.ok(inspectPaused.blockers.some(item => item.code === "successor-admitted"));
  await c.control(successor.id, "resume");
  await wait(c, successor.id, "succeeded");
}));

test("continuation seals open source waits while identical recorded answers remain idempotent", async t => {
  for (const paused of [true, false]) for (const answered of [false, true]) {
    await t.test(`${paused ? "paused" : "running intent"}, ${answered ? "answered" : "open"}`, async () => fixture(async (s, c, directory) => {
      const responseSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
      const waitNode: Node = { id: "answer", kind: "await", reason: { op: "literal", value: "fixture question" }, input: { op: "literal", value: {} }, responseSchema };
      const finish: Node = { id: "done", kind: "end", value: { op: "literal", value: { result: "next" } } };
      await author(s, "wait-source", [waitNode, finish]);
      const prepared = await s.dispatch("workflow.prepare", { id: "wait-source" }) as PreparedExecution;
      const id = "run-wait-source";
      c.store.create({ id, plan: prepared.plan, input: null, cwd: directory });
      const { token } = c.store.reserveLaunch(id);
      const activation = c.store.beginActivation(id, token, { graphId: "main", nodeId: "answer", scope: ["graph", "main"], visit: 0 }, { kind: "await", sideEffect: false });
      const opened = c.store.openWait(id, token, activation.key, "fixture question", {}, responseSchema);
      if (paused) c.store.requestControl(id, "pause");
      c.store.markInterrupted(id, token, "Fixture supervisor stopped; no external processes or effects");
      const response = { answer: "kept" };
      if (answered) c.store.resolveWait(id, opened.id, response, "first-client");
      await author(s, "wait-successor", [finish]);
      const next = await s.dispatch("workflow.prepare", { id: "wait-successor" }) as PreparedExecution;
      const inspect = await s.dispatch("run.continuation.inspect", { id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; blockers: unknown[] };
      assert.deepEqual(inspect.blockers, []);
      const successor = await s.dispatch("run.continue", {
        preparedId: next.preparedId, idempotencyKey: "wait-successor", input: null,
        source: { runId: id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest,
        actor: "tester", reason: "Replace the stopped wait workflow", evidence: ["No worker or external effect was started"], reuse: [],
      }) as { id: string };
      assert.equal(c.store.fence(id)?.successorRunId, successor.id);
      const before = c.store.getWait(id, opened.id), events = c.store.events(id);
      if (answered) {
        const delivered = await s.dispatch("run.resolve", { id, waitId: opened.id, response, resolvedBy: "duplicate-client" }) as { wait: unknown };
        assert.deepEqual(delivered.wait, before);
        assert.deepEqual(c.store.resolveWait(id, opened.id, response, "duplicate-client"), before);
        await assert.rejects(s.dispatch("run.resolve", { id, waitId: opened.id, response: { answer: "different" } }), /different response/);
      } else {
        await assert.rejects(s.dispatch("run.resolve", { id, waitId: opened.id, response }), /replaced by a continuation/);
        assert.throws(() => c.store.resolveWait(id, opened.id, response, "direct-client"), /replaced by a continuation/);
      }
      // A rejected delivery must not mutate first and fail later during relaunch.
      assert.deepEqual(c.store.getWait(id, opened.id), before);
      assert.deepEqual(c.store.events(id), events);
      assert.equal(c.store.get(id).ownerToken, null);
      if (paused) assert.equal(c.store.get(successor.id).desired, "paused");
      else await wait(c, successor.id, "succeeded");
    }));
  }
});

test("writer retain-effects is required and does not accept or retry the old attempt", async () => fixture(async (s, c, directory) => {
  await author(s, "sample", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
  const run = c.store.create({ id: "run-writer", plan: prepared.plan, input: null, cwd: directory });
  const { token } = c.store.reserveLaunch(run.id);
  const context = { scope: ["graph", "main"], graphId: "main", nodeId: "plan", visit: 0 };
  c.store.beginActivation(run.id, token, context, { kind: "check", sideEffect: true });
  const key = activationKey(context);
  c.store.setActivationMetadata(run.id, token, key, { operation: { kind: "check", cwd: directory, command: "echo", args: [] } });
  c.store.failActivation(run.id, token, key, "writer failed", executionFailure("unknown", "execution", "unknown", "writer failed").failure);
  c.store.finish(run.id, token, { status: "failed", error: "writer failed" });
  const inspect = await s.dispatch("run.continuation.inspect", { id: run.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
  await author(s, "next", [{ id: "done", kind: "end", value: { op: "literal", value: 1 } }]);
  const next = await s.dispatch("workflow.prepare", { id: "next" }) as PreparedExecution;
  const request = {
    preparedId: next.preparedId, idempotencyKey: "disp", input: null, actor: "t", reason: "keep effects", evidence: ["files remain"],
    source: { runId: run.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest, reuse: [],
  };
  await assert.rejects(s.dispatch("run.continue", request), /writer-disposition-required/);
  const continued = await s.dispatch("run.continue", {
    ...request, dispositions: [{ key, attempt: 1, disposition: "retain-effects", evidence: ["left the original write in place"] }],
  }) as { id: string };
  await wait(c, continued.id, "succeeded");
  assert.equal(c.store.get(run.id).status, "failed");
  assert.equal(c.store.getActivation(run.id, key)?.status, "failed");
}));

for (const firstEffects of ["not-started", "read-only"] as const) test(`inspect exposes unknown cleanup after ${firstEffects} and continue requires the displayed writer disposition`, async () => fixture(async (s, c, directory) => {
  await author(s, "original", [writeFail, { id: "done", kind: "end", value: { op: "literal", value: null } }]);
  const prepared = await s.dispatch("workflow.prepare", { id: "original" }) as PreparedExecution;
  const run = c.store.create({ id: "run-composite-writer", plan: prepared.plan, input: null, cwd: directory });
  const { token } = c.store.reserveLaunch(run.id);
  const context = { scope: ["graph", "main"], graphId: "main", nodeId: "write", visit: 0 };
  const original = c.store.beginActivation(run.id, token, context, { kind: "check", sideEffect: true });
  const primary = executionFailure("process", "setup", firstEffects, "Primary failure").failure;
  const cleanup = executionFailure("uncertain-effect", "cleanup", "unknown", "Cleanup not confirmed").failure;
  c.store.failActivation(run.id, token, original.key, "Primary and cleanup failure", primary, { retryCauses: [primary, cleanup] });
  c.store.finish(run.id, token, { status: "failed", error: "Primary and cleanup failure" });
  const before = c.store.getActivation(run.id, original.key);
  await author(s, "next", [{ id: "done", kind: "end", value: { op: "literal", value: "continued" } }]);
  const next = await s.dispatch("workflow.prepare", { id: "next" }) as PreparedExecution;
  const inspect = await s.dispatch("run.continuation.inspect", { id: run.id }) as Awaited<ReturnType<RunController["continuationInspect"]>>;
  assert.deepEqual(inspect.blockers, []);
  assert.deepEqual(inspect.writerEffects, [{ key: original.key, attempt: 1, kind: "check", operation: true, effects: "unknown" }]);
  const request = {
    preparedId: next.preparedId, idempotencyKey: "composite-continuation", input: null,
    actor: "tester", reason: "Retain effects of the inspected attempt", evidence: ["Inspected both failure causes"],
    source: { runId: run.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace!.digest,
  };
  await assert.rejects(s.dispatch("run.continue", request), /writer-disposition-required/);
  assert.equal(c.store.listRuns().length, 1);
  assert.equal(c.store.fence(run.id), undefined);
  const dispositions = inspect.writerEffects.filter(writer => writer.effects === "unknown").map(writer => ({
    key: writer.key, attempt: writer.attempt, disposition: "retain-effects", evidence: ["Inspected workspace; retain original effects"],
  }));
  await assert.rejects(s.dispatch("run.continue", { ...request, dispositions: dispositions.map(item => ({ ...item, attempt: 2 })) }), /writer-disposition-required/);
  const continued = await s.dispatch("run.continue", { ...request, dispositions }) as { id: string };
  assert.equal((await wait(c, continued.id, "succeeded")).output, "continued");
  assert.deepEqual(c.store.getActivation(run.id, original.key), before, "continuation must not accept or replay the uncertain source attempt");
  assert.equal(c.store.listActivations(continued.id).some(record => record.sideEffect), false);
}));

test("malicious continuation reason is projected as text and reused nodes have no model", async () => fixture(async (s, c) => {
  await author(s, "sample", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
  const original = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "o", input: null }) as { id: string };
  await wait(c, original.id, "succeeded");
  await author(s, "rev", [reuseNode, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const revised = await s.dispatch("workflow.prepare", { id: "rev" }) as PreparedExecution;
  const inspect = await s.dispatch("run.continuation.inspect", { id: original.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
  const planKey = activationKey({ scope: ["graph", "main"], graphId: "main", nodeId: "plan", visit: 0 });
  const continued = await s.dispatch("run.continue", {
    preparedId: revised.preparedId, idempotencyKey: "xss", input: null,
    source: { runId: original.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "tester", reason: "<img src=x onerror=alert(1)>", evidence: ["<script>alert(1)</script>"],
    workspaceDigest: inspect.workspace.digest,
    reuse: [{ bindingId: "planner", sourceRunId: original.id, activationKey: planKey, attempt: 1 }],
  }) as { id: string; lineage?: { receipt?: { reason: string } } };
  await wait(c, continued.id, "succeeded");
  const snapshot = await s.dispatch("run.inspect", { id: continued.id }) as { lineage?: { receipt?: { reason: string } }; agents: { nodeId: string }[] };
  assert.equal(snapshot.lineage?.receipt?.reason, "<img src=x onerror=alert(1)>");
  assert.equal(snapshot.agents.some(agent => agent.nodeId === "prior"), false);
}));

test("reuse from a reuse node keeps the original producer", { timeout: 30_000 }, async () => fixture(async (s, c) => {
  await author(s, "orig", [planNode, done]);
  const prepared = await s.dispatch("workflow.prepare", { id: "orig" }) as PreparedExecution;
  const original = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "p0", input: null }) as { id: string };
  await wait(c, original.id, "succeeded");
  await author(s, "mid", [reuseNode, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const midPlan = await s.dispatch("workflow.prepare", { id: "mid" }) as PreparedExecution;
  const inspect = await s.dispatch("run.continuation.inspect", { id: original.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; reusable: { nodeId: string; key: string; attempt: number; outputDigest: string; schemaDigest: string | null; producerSchemaDigest: string | null }[] };
  const prior = inspect.reusable.find(item => item.nodeId === "plan");
  assert.ok(prior);
  const mid = await s.dispatch("run.continue", {
    preparedId: midPlan.preparedId, idempotencyKey: "p1", input: null, actor: "t", reason: "first reuse", evidence: ["e"],
    source: { runId: original.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest,
    reuse: [{ bindingId: "planner", sourceRunId: original.id, activationKey: prior.key, attempt: prior.attempt, sourceOutputDigest: prior.outputDigest, ...(prior.schemaDigest ? { sourceSchemaDigest: prior.schemaDigest } : {}) }],
  }) as { id: string };
  await wait(c, mid.id, "succeeded");
  await author(s, "late", [reuseNode, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const latePlan = await s.dispatch("workflow.prepare", { id: "late" }) as PreparedExecution;
  const inspect2 = await s.dispatch("run.continuation.inspect", { id: mid.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; reusable: { nodeId: string; key: string; attempt: number; outputDigest: string; schemaDigest: string | null; producerSchemaDigest: string | null }[] };
  const reused = inspect2.reusable.find(item => item.nodeId === "prior");
  assert.ok(reused?.schemaDigest);
  const late = await s.dispatch("run.continue", {
    preparedId: latePlan.preparedId, idempotencyKey: "p2", input: null, actor: "t", reason: "chain", evidence: ["e"],
    source: { runId: mid.id, checkpoint: inspect2.checkpoint, planHash: inspect2.planHash }, workspaceDigest: inspect2.workspace.digest,
    reuse: [{ bindingId: "planner", sourceRunId: mid.id, activationKey: reused.key, attempt: reused.attempt, sourceOutputDigest: reused.outputDigest, sourceSchemaDigest: reused.schemaDigest, ...(reused.producerSchemaDigest ? { producerSchemaDigest: reused.producerSchemaDigest } : {}) }],
  }) as { id: string };
  const finished = await wait(c, late.id, "succeeded");
  const receipt = c.store.receiptForTarget(late.id)!;
  assert.equal(receipt.reused[0]!.producerRunId, original.id);
  assert.equal(receipt.reused[0]!.producerNodeId, "plan");
  assert.equal((finished.output as { result?: string }).result, "plan-v1");
}));

test("chained reuse accepts the inspected source schema digest when it differs from the producer schema", { timeout: 30_000 }, async () => fixture(async (s, c) => {
  const checkNode: Node = { id: "probe", kind: "check", command: process.execPath, args: ["-e", "process.exit(0)"] };
  await author(s, "runA", [checkNode, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "probe"] } }]);
  const planA = await s.dispatch("workflow.prepare", { id: "runA" }) as PreparedExecution;
  const runA = await s.dispatch("run.start", { preparedId: planA.preparedId, idempotencyKey: "chain-a", input: null }) as { id: string };
  await wait(c, runA.id, "succeeded");
  const inspectA = await s.dispatch("run.continuation.inspect", { id: runA.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; reusable: { nodeId: string; key: string; attempt: number; outputDigest: string; schemaDigest: string | null; producerSchemaDigest: string | null }[] };
  const probe = inspectA.reusable.find(item => item.nodeId === "probe");
  assert.ok(probe?.schemaDigest);
  const producerSchemaDigest = probe.producerSchemaDigest ?? probe.schemaDigest;
  const strictSchema = {
    type: "object", additionalProperties: false, required: ["exitCode", "stdout", "stderr"],
    properties: { exitCode: { type: "integer", const: 0 }, stdout: { type: "string" }, stderr: { type: "string" } },
  };
  const strictReuse: Node = { id: "prior", kind: "reuse", bindingId: "savedCheck", outputSchema: strictSchema };
  await author(s, "runB", [strictReuse, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const planB = await s.dispatch("workflow.prepare", { id: "runB" }) as PreparedExecution;
  const runB = await s.dispatch("run.continue", {
    preparedId: planB.preparedId, idempotencyKey: "chain-b", input: null, actor: "t", reason: "stricter reuse schema", evidence: ["checked exit 0"],
    source: { runId: runA.id, checkpoint: inspectA.checkpoint, planHash: inspectA.planHash }, workspaceDigest: inspectA.workspace.digest,
    reuse: [{ bindingId: "savedCheck", sourceRunId: runA.id, activationKey: probe.key, attempt: probe.attempt, sourceOutputDigest: probe.outputDigest, sourceSchemaDigest: probe.schemaDigest! }],
  }) as { id: string };
  await wait(c, runB.id, "succeeded");
  const inspectB = await s.dispatch("run.continuation.inspect", { id: runB.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; reusable: { nodeId: string; key: string; attempt: number; outputDigest: string; schemaDigest: string | null; producerSchemaDigest: string | null }[] };
  const saved = inspectB.reusable.find(item => item.nodeId === "prior");
  assert.ok(saved?.schemaDigest);
  assert.equal(saved.schemaDigest, digestJson(strictSchema));
  assert.notEqual(saved.schemaDigest, producerSchemaDigest);
  assert.equal(saved.producerSchemaDigest, producerSchemaDigest);
  await author(s, "runC", [strictReuse, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const planC = await s.dispatch("workflow.prepare", { id: "runC" }) as PreparedExecution;
  await assert.rejects(s.dispatch("run.continue", {
    preparedId: planC.preparedId, idempotencyKey: "chain-c-stale", input: null, actor: "t", reason: "stale source schema", evidence: ["e"],
    source: { runId: runB.id, checkpoint: inspectB.checkpoint, planHash: inspectB.planHash }, workspaceDigest: inspectB.workspace.digest,
    reuse: [{ bindingId: "savedCheck", sourceRunId: runB.id, activationKey: saved.key, attempt: saved.attempt, sourceOutputDigest: saved.outputDigest, sourceSchemaDigest: producerSchemaDigest! }],
  }), /source schema digest mismatch/);
  const runC = await s.dispatch("run.continue", {
    preparedId: planC.preparedId, idempotencyKey: "chain-c", input: null, actor: "t", reason: "use inspected source schema", evidence: ["e"],
    source: { runId: runB.id, checkpoint: inspectB.checkpoint, planHash: inspectB.planHash }, workspaceDigest: inspectB.workspace.digest,
    reuse: [{ bindingId: "savedCheck", sourceRunId: runB.id, activationKey: saved.key, attempt: saved.attempt, sourceOutputDigest: saved.outputDigest, sourceSchemaDigest: saved.schemaDigest!, producerSchemaDigest: saved.producerSchemaDigest! }],
  }) as { id: string };
  const finished = await wait(c, runC.id, "succeeded");
  assert.equal((finished.output as { exitCode?: number }).exitCode, 0);
  const receipt = c.store.receiptForTarget(runC.id)!;
  assert.equal(receipt.reused[0]!.producerRunId, runA.id);
  assert.equal(receipt.reused[0]!.schemaDigest, saved.schemaDigest);
  assert.equal(receipt.reused[0]!.producerSchemaDigest, producerSchemaDigest);
  assert.equal(c.store.listActivations(runC.id).some(item => item.kind === "agent"), false);
}));

test("schemaless producer does not invent a producer schema digest across compatible reuse schemas", { timeout: 30_000 }, async () => fixture(async (s, c) => {
  await author(s, "plainA", [
    { id: "check", kind: "transform", value: { op: "literal", value: { exitCode: 0, stdout: "ok", stderr: "" } } },
    { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "check"] } },
  ]);
  const planA = await s.dispatch("workflow.prepare", { id: "plainA" }) as PreparedExecution;
  const runA = await s.dispatch("run.start", { preparedId: planA.preparedId, idempotencyKey: "plain-a", input: null }) as { id: string };
  await wait(c, runA.id, "succeeded");
  const inspectA = await s.dispatch("run.continuation.inspect", { id: runA.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; reusable: { nodeId: string; key: string; attempt: number; outputDigest: string; schemaDigest: string | null; producerSchemaDigest: string | null }[] };
  const probe = inspectA.reusable.find(item => item.nodeId === "check");
  assert.ok(probe);
  assert.equal(probe.schemaDigest, null);
  assert.equal(probe.producerSchemaDigest, null);
  const strictSchema = {
    type: "object", additionalProperties: false, required: ["exitCode", "stdout", "stderr"],
    properties: { exitCode: { type: "integer", const: 0 }, stdout: { type: "string" }, stderr: { type: "string" } },
  };
  const wideSchema = structuredClone(strictSchema);
  delete (wideSchema.properties.exitCode as { const?: number }).const;
  await author(s, "plainB", [{ id: "prior", kind: "reuse", bindingId: "checkResult", outputSchema: strictSchema }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const planB = await s.dispatch("workflow.prepare", { id: "plainB" }) as PreparedExecution;
  const runB = await s.dispatch("run.continue", {
    preparedId: planB.preparedId, idempotencyKey: "plain-b", input: null, actor: "t", reason: "strict reuse of schemaless producer", evidence: ["e"],
    source: { runId: runA.id, checkpoint: inspectA.checkpoint, planHash: inspectA.planHash }, workspaceDigest: inspectA.workspace.digest,
    reuse: [{ bindingId: "checkResult", sourceRunId: runA.id, activationKey: probe.key, attempt: probe.attempt, sourceOutputDigest: probe.outputDigest, ...(probe.schemaDigest ? { sourceSchemaDigest: probe.schemaDigest } : {}), ...(probe.producerSchemaDigest ? { producerSchemaDigest: probe.producerSchemaDigest } : {}) }],
  }) as { id: string };
  await wait(c, runB.id, "succeeded");
  const inspectB = await s.dispatch("run.continuation.inspect", { id: runB.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; reusable: { nodeId: string; key: string; attempt: number; outputDigest: string; schemaDigest: string | null; producerSchemaDigest: string | null }[] };
  const saved = inspectB.reusable.find(item => item.nodeId === "prior");
  assert.ok(saved?.schemaDigest);
  assert.equal(saved.schemaDigest, digestJson(strictSchema));
  assert.equal(saved.producerSchemaDigest, null);
  await author(s, "plainC", [{ id: "prior", kind: "reuse", bindingId: "checkResult", outputSchema: wideSchema }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } }]);
  const planC = await s.dispatch("workflow.prepare", { id: "plainC" }) as PreparedExecution;
  const runC = await s.dispatch("run.continue", {
    preparedId: planC.preparedId, idempotencyKey: "plain-c", input: null, actor: "t", reason: "wider compatible reuse", evidence: ["e"],
    source: { runId: runB.id, checkpoint: inspectB.checkpoint, planHash: inspectB.planHash }, workspaceDigest: inspectB.workspace.digest,
    reuse: [{ bindingId: "checkResult", sourceRunId: runB.id, activationKey: saved.key, attempt: saved.attempt, sourceOutputDigest: saved.outputDigest, ...(saved.schemaDigest ? { sourceSchemaDigest: saved.schemaDigest } : {}), ...(saved.producerSchemaDigest ? { producerSchemaDigest: saved.producerSchemaDigest } : {}) }],
  }) as { id: string };
  const finished = await wait(c, runC.id, "succeeded");
  assert.equal((finished.output as { exitCode?: number; stdout?: string }).exitCode, 0);
  assert.equal((finished.output as { stdout?: string }).stdout, "ok");
  assert.equal(c.store.receiptForTarget(runC.id)!.reused[0]!.producerSchemaDigest, undefined);
  assert.equal(c.store.listActivations(runC.id).filter(item => item.kind === "agent" || item.kind === "check").length, 0);
}));

test("public status, snapshot, task inspect and HTTP omit continuation input", { timeout: 30_000 }, async () => fixture(async (s, c, directory, filename) => {
  await author(s, "proj", [{ id: "done", kind: "end", value: { op: "literal", value: { accepted: true } } }]);
  const prepared = await s.dispatch("workflow.prepare", { id: "proj" }) as PreparedExecution;
  const source = c.store.create({ id: "run-proj-source", plan: prepared.plan, input: null, cwd: prepared.cwd, start: { preparedId: prepared.preparedId, idempotencyKey: "proj-source" } });
  c.store.requestControl(source.id, "pause");
  const inspect = await s.dispatch("run.continuation.inspect", { id: source.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
  const marker = "PARENT_PRIVATE_CONTINUATION_INPUT_MUST_NOT_REACH_PUBLIC_STATUS";
  const target = await s.dispatch("run.continue", {
    preparedId: prepared.preparedId, idempotencyKey: "proj-target",
    source: { runId: source.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "qa", reason: "Public lineage projection", evidence: ["fixture"], input: { private: marker }, reuse: [], workspaceDigest: inspect.workspace.digest,
  }) as { id: string; status: string; lineage?: { taskId: string; receipt?: { canonicalRequest?: unknown } } };
  assert.equal(target.status, "paused");
  const run = c.store.get(target.id);
  const views: [string, unknown][] = [
    ["run.continue", target], ["publicRunSummary", publicRunSummary(run)], ["graphSnapshot", graphSnapshot(run, [])],
    ["run.status", await s.dispatch("run.status", { id: target.id })],
    ["task.inspect", await s.dispatch("task.inspect", { id: run.lineage!.taskId })],
  ];
  for (const [name, value] of views) assert.equal(JSON.stringify(value).includes(marker), false, name);
  assert.equal(target.lineage?.receipt && "canonicalRequest" in target.lineage.receipt, false);
  const server = await startGraphServer(filename, target.id);
  try {
    const snap = await (await fetch(`${server.url}snapshot?id=${target.id}`)).json() as { lineage?: { receipt?: { canonicalRequest?: unknown } } };
    const task = await (await fetch(`${server.url}task?id=${run.lineage!.taskId}`)).json() as { receipts: { canonicalRequest?: unknown }[] };
    assert.equal(JSON.stringify(snap).includes(marker), false);
    assert.equal(JSON.stringify(task).includes(marker), false);
    assert.equal(snap.lineage?.receipt && "canonicalRequest" in snap.lineage.receipt, false);
  } finally { await server.close(); }
}));

test("paused successor refuses first admission after workspace files change", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  await writeFile(join(directory, "reviewed-input.txt"), "inspected version");
  await author(s, "parentSource", [{ id: "done", kind: "end", value: { op: "literal", value: { accepted: true } } }]);
  const sourcePlan = await s.dispatch("workflow.prepare", { id: "parentSource" }) as PreparedExecution;
  await author(s, "parentTarget", [
    { id: "write", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('WRITER_RAN','unexpected')"] },
    { id: "done", kind: "end", value: { op: "literal", value: { accepted: true } } },
  ]);
  const targetPlan = await s.dispatch("workflow.prepare", { id: "parentTarget" }) as PreparedExecution;
  const source = c.store.create({ id: "run-paused-src", plan: sourcePlan.plan, input: null, cwd: sourcePlan.cwd, start: { preparedId: sourcePlan.preparedId, idempotencyKey: "paused-src-2" } });
  c.store.requestControl(source.id, "pause");
  const inspect = await s.dispatch("run.continuation.inspect", { id: source.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; blockers: unknown[] };
  assert.equal(inspect.blockers.length, 0);
  const target = await s.dispatch("run.continue", {
    preparedId: targetPlan.preparedId, idempotencyKey: "paused-tgt",
    source: { runId: source.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "qa", reason: "Exercise paused continuation admission", evidence: ["files inspected"], input: null, reuse: [], workspaceDigest: inspect.workspace.digest,
  }) as { id: string; status: string };
  assert.equal(target.status, "paused");
  await writeFile(join(directory, "reviewed-input.txt"), "changed AFTER continuation receipt but BEFORE first admission");
  const request = {
    preparedId: targetPlan.preparedId, idempotencyKey: "paused-tgt",
    source: { runId: source.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "qa", reason: "Exercise paused continuation admission", evidence: ["files inspected"], input: null, reuse: [], workspaceDigest: inspect.workspace.digest,
  };
  const redelivered = await s.dispatch("run.continue", request) as { id: string; status: string };
  assert.equal(redelivered.id, target.id);
  assert.equal(redelivered.status, "paused");
  await assert.rejects(s.dispatch("run.resume", { id: target.id }), /workspace|digest|files.*changed|changed.*files/i);
  await assert.rejects(readFile(join(directory, "WRITER_RAN"), "utf8"), /ENOENT/);
}));

test("concurrent identical continue deliveries return one run", { timeout: 30_000 }, async () => fixture(async (s, c, directory, filename) => {
  await author(s, "sample", [{ id: "done", kind: "end", value: { op: "literal", value: { ok: true } } }]);
  const prepared = await s.dispatch("workflow.prepare", { id: "sample" }) as PreparedExecution;
  const original = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: "orig-c", input: null }) as { id: string };
  await wait(c, original.id, "succeeded");
  const inspect = await s.dispatch("run.continuation.inspect", { id: original.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const body = JSON.stringify({
    preparedId: prepared.preparedId, idempotencyKey: "concurrent-continue", input: { a: 1, b: 2 },
    source: { runId: original.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "qa", reason: "concurrent", evidence: ["e"], workspaceDigest: inspect.workspace.digest, reuse: [],
  });
  const deliver = () => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, "run.continue", "--store", filename], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdin.end(body);
    child.once("close", code => {
      try { assert.equal(code, 0, stderr + stdout); resolve(JSON.parse(stdout).result.id); } catch (error) { reject(error); }
    });
  });
  const ids = await Promise.all([deliver(), deliver(), deliver()]);
  assert.equal(new Set(ids).size, 1);
  await wait(c, ids[0]!, "succeeded");
}));

test("reservation before spawn still revalidates workspace on later resume", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  await writeFile(join(directory, "reviewed-input.txt"), "inspected version");
  await author(s, "gapSource", [{ id: "done", kind: "end", value: { op: "literal", value: { accepted: true } } }]);
  const sourcePlan = await s.dispatch("workflow.prepare", { id: "gapSource" }) as PreparedExecution;
  await author(s, "gapTarget", [
    { id: "write", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('WRITER_RAN','unexpected')"] },
    { id: "done", kind: "end", value: { op: "literal", value: { accepted: true } } },
  ]);
  const targetPlan = await s.dispatch("workflow.prepare", { id: "gapTarget" }) as PreparedExecution;
  const source = c.store.create({ id: "run-gap-src", plan: sourcePlan.plan, input: null, cwd: sourcePlan.cwd, start: { preparedId: sourcePlan.preparedId, idempotencyKey: "gap-src" } });
  c.store.requestControl(source.id, "pause");
  const inspect = await s.dispatch("run.continuation.inspect", { id: source.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
  const target = await s.dispatch("run.continue", {
    preparedId: targetPlan.preparedId, idempotencyKey: "gap-tgt",
    source: { runId: source.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    actor: "qa", reason: "gap", evidence: ["e"], input: null, reuse: [], workspaceDigest: inspect.workspace.digest,
  }) as { id: string; status: string };
  assert.equal(target.status, "paused");
  c.store.requestControl(target.id, "resume");
  const reservation = c.store.reserveLaunch(target.id);
  c.store.markInterrupted(target.id, reservation.token, "QA launcher stopped before any supervisor or worker was spawned");
  assert.equal(c.store.listActivations(target.id).length, 0);
  await writeFile(join(directory, "reviewed-input.txt"), "changed after reservation without a writer");
  await assert.rejects(s.dispatch("run.resume", { id: target.id }), /workspace|digest|files.*changed|changed.*files/i);
  await assert.rejects(readFile(join(directory, "WRITER_RAN"), "utf8"), /ENOENT/);
}));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const worktreeFlow = (): WorkflowDefinition => ({
  schemaVersion: 1, id: "wt", name: "wt", revision: 1, entryGraph: "main",
  graphs: {
    main: { entry: "tree", nodes: [
      { id: "tree", kind: "worktree", graphId: "child", input: { op: "literal", value: null } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "tree"] } },
    ], edges: [{ from: "tree", to: "done" }] },
    child: { entry: "done", nodes: [{ id: "done", kind: "end", value: { op: "literal", value: { child: true } } }], edges: [] },
  },
});
async function seedUncertainWorktree(
  c: RunController,
  directory: string,
  id: string,
  phase: "children" | "allocating" = "children",
  settle: "failed" | "paused" = "failed",
) {
  const repo = join(directory, `repo-${id}`);
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const plan = await prepareExecutionPlan(worktreeFlow(), { cwd: directory, availableModels: [] });
  const run = c.store.create({ id, plan, input: null, cwd: directory });
  const { token } = c.store.reserveLaunch(run.id);
  const context = { scope: ["graph", "main"], graphId: "main", nodeId: "tree", visit: 0 };
  const key = activationKey(context);
  c.store.beginActivation(run.id, token, context, { kind: "worktree", sideEffect: true });
  const allocation = await new GitWorkspaces(run.id, c.directory(run.id)).allocate(repo, key, undefined);
  c.store.setActivationMetadata(run.id, token, key, {
    operation: { kind: "worktree", source: repo, childScope: ["graph", "child"] },
    workspace: { ...allocation }, workspacePhase: phase,
  });
  c.store.failActivation(run.id, token, key, "worktree failed", executionFailure("unknown", "execution", "unknown", "worktree failed").failure);
  if (settle === "paused") {
    c.store.requestControl(run.id, "pause");
    c.store.markInterrupted(run.id, token, "stopped for continuation QA");
  } else {
    c.store.finish(run.id, token, { status: "failed", error: "worktree failed" });
  }
  return { key, allocation, repo };
}
async function prepareSuccessor(s: WorkflowService, id: string) {
  await author(s, id, [{ id: "done", kind: "end", value: { op: "literal", value: { ok: true } } }]);
  return s.dispatch("workflow.prepare", { id }) as Promise<PreparedExecution>;
}
async function continueWithRetain(
  s: WorkflowService,
  sourceId: string,
  prepared: PreparedExecution,
  idempotencyKey: string,
  key: string,
) {
  const inspect = await s.dispatch("run.continuation.inspect", { id: sourceId }) as { checkpoint: string; planHash: string; workspace: { digest: string }; blockers: { code: string }[] };
  return s.dispatch("run.continue", {
    preparedId: prepared.preparedId, idempotencyKey, input: null, actor: "t", reason: "retain original git effects", evidence: ["inspected"],
    source: { runId: sourceId, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
    workspaceDigest: inspect.workspace.digest, reuse: [],
    dispositions: [{ key, attempt: 1, disposition: "retain-effects", evidence: ["keep original workspace"] }],
  });
}

test("continue reuses a succeeded null object-schema output without inference", { timeout: 30_000 }, async () => fixture(async (s, c) => {
  await author(s, "NullSource", [{ id: "done", kind: "end", value: { op: "literal", value: null } }]);
  const first = await s.dispatch("workflow.prepare", { id: "NullSource" }) as PreparedExecution;
  const source = await s.dispatch("run.start", { preparedId: first.preparedId, idempotencyKey: "null-source", input: null }) as { id: string };
  await wait(c, source.id, "succeeded");
  await author(s, "NullTarget", [
    { id: "prior", kind: "reuse", bindingId: "nullResult", outputSchema: { type: "object", nullable: true, additionalProperties: false } },
    { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } },
  ]);
  const target = await s.dispatch("workflow.prepare", { id: "NullTarget" }) as PreparedExecution;
  const inspection = await s.dispatch("run.continuation.inspect", { id: source.id }) as { checkpoint: string; planHash: string; workspace: { digest: string }; blockers: unknown[]; reusable: { nodeId: string; key: string; attempt: number }[] };
  assert.deepEqual(inspection.blockers, []);
  const prior = inspection.reusable.find(item => item.nodeId === "done");
  assert.ok(prior);
  const next = await s.dispatch("run.continue", {
    preparedId: target.preparedId, idempotencyKey: "null-target",
    source: { runId: source.id, checkpoint: inspection.checkpoint, planHash: inspection.planHash },
    actor: "qa", reason: "A valid null result must remain reusable", evidence: ["Pure source end returned null"],
    input: null, workspaceDigest: inspection.workspace.digest,
    reuse: [{ bindingId: "nullResult", sourceRunId: source.id, activationKey: prior.key, attempt: prior.attempt }],
  }) as { id: string };
  const finished = await wait(c, next.id, "succeeded");
  assert.equal(finished.output, null);
  assert.equal(c.store.listActivations(next.id).filter(item => item.kind === "agent").length, 0);
}));

test("retain-effects cannot bypass missing operation or unresolved Git continuation blockers", { timeout: 60_000 }, async () => fixture(async (s, c, directory, filename) => {
  const prepared = await prepareSuccessor(s, "next-git");
  const before = c.store.listRuns().length;
  const malformed = c.store.create({ id: "run-malformed-op", plan: prepared.plan, input: null, cwd: directory });
  const { token } = c.store.reserveLaunch(malformed.id);
  const checkCtx = { scope: ["graph", "main"], graphId: "main", nodeId: "done", visit: 0 };
  const checkKey = activationKey(checkCtx);
  c.store.beginActivation(malformed.id, token, checkCtx, { kind: "check", sideEffect: true });
  c.store.failActivation(malformed.id, token, checkKey, "writer failed", executionFailure("unknown", "execution", "unknown", "writer failed").failure);
  c.store.finish(malformed.id, token, { status: "failed", error: "writer failed" });
  const injected = new DatabaseSync(filename);
  try {
    injected.prepare("UPDATE workflow_activations SET metadata=json_set(metadata,'$.operation',json(?)) WHERE run_id=? AND activation_key=?").run(JSON.stringify({ kind: "check" }), malformed.id, checkKey);
  } finally { injected.close(); }
  const missingInspect = await s.dispatch("run.continuation.inspect", { id: malformed.id }) as { blockers: { code: string }[]; workspace: { digest: string } };
  assert.ok(missingInspect.blockers.some(item => item.code === "missing-operation"));
  await assert.rejects(continueWithRetain(s, malformed.id, prepared, "malformed-op", checkKey), /missing-operation/);
  assert.equal(c.store.listRuns().length, before + 1);
  assert.equal(c.store.fence(malformed.id), undefined);

  const missing = await seedUncertainWorktree(c, directory, "run-missing-child");
  await rm(missing.allocation.path, { recursive: true, force: true });
  const missingGit = await s.dispatch("run.continuation.inspect", { id: "run-missing-child" }) as { blockers: { code: string }[] };
  assert.ok(missingGit.blockers.some(item => item.code === "missing-child-workspace"));
  await assert.rejects(continueWithRetain(s, "run-missing-child", prepared, "missing-child", missing.key), /missing-child-workspace/);
  assert.equal(c.store.fence("run-missing-child"), undefined);

  const locked = await seedUncertainWorktree(c, directory, "run-locked-reg", "allocating");
  git(locked.repo, "worktree", "lock", "--reason", "User mount", locked.allocation.path);
  await rm(locked.allocation.path, { recursive: true, force: true });
  const lockedInspect = await s.dispatch("run.continuation.inspect", { id: "run-locked-reg" }) as { blockers: { code: string }[] };
  assert.ok(lockedInspect.blockers.some(item => item.code === "locked-registration"));
  await assert.rejects(continueWithRetain(s, "run-locked-reg", prepared, "locked-reg", locked.key), /locked-registration/);
  assert.equal(c.store.fence("run-locked-reg"), undefined);

  const moved = await seedUncertainWorktree(c, directory, "run-moved-branch");
  git(moved.allocation.path, "checkout", "-B", "other-branch");
  const movedInspect = await s.dispatch("run.continuation.inspect", { id: "run-moved-branch" }) as { blockers: { code: string }[] };
  assert.ok(movedInspect.blockers.some(item => item.code === "unresolved-worktree-ownership"));
  await assert.rejects(continueWithRetain(s, "run-moved-branch", prepared, "moved-branch", moved.key), /unresolved-worktree-ownership/);
  assert.equal(c.store.fence("run-moved-branch"), undefined);

  const integrateId = "run-bad-integrate";
  const repo = join(directory, "repo-integrate");
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const head = git(repo, "rev-parse", "HEAD");
  const integratePlan = await prepareExecutionPlan({
    schemaVersion: 1, id: "ig", name: "ig", revision: 1, entryGraph: "main",
    graphs: { main: { entry: "merge", nodes: [
      { id: "merge", kind: "integrate", sources: { op: "literal", value: [] } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "merge"] } },
    ], edges: [{ from: "merge", to: "done" }] } },
  }, { cwd: directory, availableModels: [] });
  const integrate = c.store.create({ id: integrateId, plan: integratePlan, input: null, cwd: directory });
  const launched = c.store.reserveLaunch(integrate.id);
  const mergeCtx = { scope: ["graph", "main"], graphId: "main", nodeId: "merge", visit: 0 };
  const mergeKey = activationKey(mergeCtx);
  c.store.beginActivation(integrate.id, launched.token, mergeCtx, { kind: "integrate", sideEffect: true });
  c.store.setActivationMetadata(integrate.id, launched.token, mergeKey, {
    operation: { kind: "integrate", target: repo, sources: [{ path: repo, branch: "main", base: head, head }] },
  });
  c.store.failActivation(integrate.id, launched.token, mergeKey, "integrate failed", executionFailure("unknown", "execution", "unknown", "integrate failed").failure);
  c.store.finish(integrate.id, launched.token, { status: "failed", error: "integrate failed" });
  const integrateInspect = await s.dispatch("run.continuation.inspect", { id: integrateId }) as { blockers: { code: string }[] };
  assert.ok(integrateInspect.blockers.some(item => item.code === "invalid-integration"));
  await assert.rejects(continueWithRetain(s, integrateId, prepared, "bad-integrate", mergeKey), /invalid-integration/);
  assert.equal(c.store.fence(integrateId), undefined);

  const ok = await seedUncertainWorktree(c, directory, "run-ok-worktree");
  const continued = await continueWithRetain(s, "run-ok-worktree", prepared, "ok-worktree", ok.key) as { id: string };
  await wait(c, continued.id, "succeeded");
  assert.equal(c.store.get("run-ok-worktree").status, "failed");
}));

test("first admission revalidates source Git ownership after a paused continuation", { timeout: 30_000 }, async () => fixture(async (s, c, directory) => {
  const seeded = await seedUncertainWorktree(c, directory, "run-paused-git", "children", "paused");
  const prepared = await prepareSuccessor(s, "paused-git-target");
  const target = await continueWithRetain(s, "run-paused-git", prepared, "paused-git", seeded.key) as { id: string; status: string };
  assert.equal(target.status, "paused");
  git(seeded.allocation.path, "checkout", "-B", "moved-after-receipt");
  await assert.rejects(s.dispatch("run.resume", { id: target.id }), /unresolved-worktree-ownership/);
  assert.equal(c.store.listActivations(target.id).length, 0);
}));

test("redelivery finishes a committed continuation before its first reservation exactly once", { timeout: 30_000 }, async () => fixture(async (s, c, directory, filename) => {
  await author(s, "sourceGap", [planNode, done]);
  const sourcePlan = await s.dispatch("workflow.prepare", { id: "sourceGap" }) as PreparedExecution;
  const source = await s.dispatch("run.start", { preparedId: sourcePlan.preparedId, idempotencyKey: "gap-source" }) as { id: string };
  await wait(c, source.id, "succeeded");
  await author(s, "targetGap", [writeOk, { id: "done", kind: "end", value: { op: "literal", value: true } }]);
  const targetPlan = await s.dispatch("workflow.prepare", { id: "targetGap" }) as PreparedExecution;
  const inspection = await c.continuationInspect(source.id);
  const request = { preparedId: targetPlan.preparedId, idempotencyKey: "gap-cont", actor: "test", reason: "gap", evidence: ["source complete"], source: { runId: source.id, checkpoint: inspection.checkpoint, planHash: inspection.planHash }, workspaceDigest: inspection.workspace!.digest };
  const original = RunController.prototype.completeStart;
  RunController.prototype.completeStart = async function(id) {
    if (this.store.receiptForTarget(id)) throw new Error("injected create-before-reserve");
    return original.call(this, id);
  };
  try { await assert.rejects(s.dispatch("run.continue", request), /create-before-reserve/); }
  finally { RunController.prototype.completeStart = original; }
  const fresh = new WorkflowService(filename, { cwd: directory, availableModels: [] });
  try {
    const results = await Promise.all([fresh.dispatch("run.continue", request), s.dispatch("run.continue", request)]) as { id: string }[];
    assert.equal(results[0]!.id, results[1]!.id);
    await wait(c, results[0]!.id, "succeeded");
    assert.equal(await readFile(join(directory, "effects"), "utf8"), "continued\n");
    assert.equal(c.store.events(results[0]!.id).filter(event => event.type === "run.reserved").length, 1);
  } finally { fresh.close(); }
}));
