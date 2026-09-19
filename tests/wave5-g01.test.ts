import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveReuseBinding, type ContinuationReuseBinding } from "../src/lineage.js";
import { WorkflowService } from "../src/service.js";
import { RunController } from "../src/run-controller.js";
import type { ActivationRecord } from "../src/run-store.js";
import type { PreparedExecution } from "../src/execution-types.js";
import type { Json, Node } from "../src/graph.js";

const models = [{ provider: "test", id: "frozen", thinkingLevels: ["off"] as const }];
const approveOnly = { decision: "approve", summary: "ok", findings: [] as Json[], artifactRevision: "rev-1" };
const approveBound = { ...approveOnly, acceptanceCriteriaRevision: "c-1" };

function verdictSchema(requireCriteria: boolean): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: requireCriteria
      ? ["decision", "summary", "findings", "artifactRevision", "acceptanceCriteriaRevision"]
      : ["decision", "summary", "findings", "artifactRevision"],
    properties: {
      decision: { type: "string" },
      summary: { type: "string" },
      findings: {},
      artifactRevision: { type: "string" },
      acceptanceCriteriaRevision: { type: "string" },
    },
  };
}

function reuseVerdict(
  output: typeof approveOnly | typeof approveBound,
  input: Json,
  bindingExtra: Partial<ContinuationReuseBinding> = {},
) {
  const requireCriteria = Object.hasOwn(output, "acceptanceCriteriaRevision");
  const outputSchema = verdictSchema(requireCriteria);
  const sourceActivation = {
    runId: "run-a", key: "review",
    context: { graphId: "main", nodeId: "review", scope: ["graph", "main"], visit: 0 },
    kind: "agent", sideEffect: true, status: "succeeded", attempt: 1, ownerToken: "",
    startedAt: 0, finishedAt: 1, output, metadata: {},
  } as unknown as ActivationRecord;
  const binding: ContinuationReuseBinding = {
    bindingId: "verdict", sourceRunId: "run-a", activationKey: "review", attempt: 1,
    artifactRevision: output.artifactRevision,
    ...(requireCriteria ? { acceptanceCriteriaRevision: approveBound.acceptanceCriteriaRevision } : {}),
    ...bindingExtra,
  };
  const target = { graphId: "main", nodeId: "prior", bindingId: "verdict", outputSchema };
  return resolveReuseBinding({
    binding, target,
    sourceRun: {
      plan: {
        hash: "h",
        workflow: { graphs: { main: { nodes: [{ id: "review", kind: "agent", role: "reviewer", task: { op: "literal", value: "review" } }] } } },
        agents: { main: { review: { outputSchema } } },
      },
    } as never,
    sourceActivation, sourcePlanHash: "h", input,
    producer: {
      runId: "run-a", key: "review", attempt: 1, graphId: "main", nodeId: "review",
      output: sourceActivation.output!, schema: outputSchema,
    },
  });
}

async function author(s: WorkflowService, id: string, nodes: Node[]) {
  await s.dispatch("workflow.create", { id, name: id });
  await s.dispatch("workflow.patch", {
    id, expectedRevision: 1,
    operations: [
      ...nodes.map(node => ({ op: "addNode" as const, graphId: "main", node })),
      ...nodes.slice(1).map((node, i) => ({ op: "connect" as const, graphId: "main", edge: { from: nodes[i]!.id, to: node.id } })),
    ],
  });
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

test("reused reviewer criteria bind only when already recorded on the verdict", () => {
  assert.throws(
    () => reuseVerdict(approveBound, { artifactRevision: "rev-1", acceptanceCriteriaRevision: "c-2" }),
    /different acceptance criteria/,
  );
  const matched = reuseVerdict(approveBound, { artifactRevision: "rev-1", acceptanceCriteriaRevision: "c-1" });
  assert.equal(matched.artifactRevision, "rev-1");
  assert.equal(matched.acceptanceCriteriaRevision, "c-1");
  const unbound = reuseVerdict(approveOnly, { artifactRevision: "rev-1", acceptanceCriteriaRevision: "crit-2" });
  assert.equal(unbound.artifactRevision, "rev-1");
  assert.equal(unbound.acceptanceCriteriaRevision, undefined);
  assert.equal((unbound.value as { acceptanceCriteriaRevision?: string }).acceptanceCriteriaRevision, undefined);
  const sameArtifact = reuseVerdict(approveOnly, { artifactRevision: "rev-1" });
  assert.equal(sameArtifact.artifactRevision, "rev-1");
  assert.equal(sameArtifact.acceptanceCriteriaRevision, undefined);
});

test("run.continue applies the when-present criteria gate to reused approve", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-wave5-g01-"));
  const filename = join(directory, "state.sqlite");
  const s = new WorkflowService(filename, { cwd: directory, availableModels: models });
  const c = new RunController(filename);
  try {
    const startSource = async (id: string, output: Json) => {
      await author(s, id, [
        { id: "review", kind: "transform", value: { op: "literal", value: output } },
        { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "review"] } },
      ]);
      const prepared = await s.dispatch("workflow.prepare", { id }) as PreparedExecution;
      const run = await s.dispatch("run.start", { preparedId: prepared.preparedId, idempotencyKey: `${id}-start`, input: null }) as { id: string };
      await wait(c, run.id, "succeeded");
      return run.id;
    };
    const continueReuse = async (sourceId: string, successorId: string, requireCriteria: boolean, input: Json, idempotencyKey: string) => {
      const schema = verdictSchema(requireCriteria);
      await author(s, successorId, [
        { id: "prior", kind: "reuse", bindingId: "verdict", outputSchema: schema },
        { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prior"] } },
      ]);
      const prepared = await s.dispatch("workflow.prepare", { id: successorId }) as PreparedExecution;
      const inspect = await s.dispatch("run.continuation.inspect", { id: sourceId }) as {
        checkpoint: string; planHash: string; workspace: { digest: string };
        reusable: { nodeId: string; key: string; attempt: number; artifactRevision?: string; acceptanceCriteriaRevision?: string }[];
      };
      const review = inspect.reusable.find(item => item.nodeId === "review");
      assert.ok(review);
      return s.dispatch("run.continue", {
        preparedId: prepared.preparedId, idempotencyKey, input,
        source: { runId: sourceId, checkpoint: inspect.checkpoint, planHash: inspect.planHash },
        actor: "tester", reason: "Reuse the recorded review verdict", evidence: ["inspected the succeeded transform output"],
        workspaceDigest: inspect.workspace.digest,
        reuse: [{
          bindingId: "verdict", sourceRunId: sourceId, activationKey: review.key, attempt: review.attempt,
          ...(review.artifactRevision ? { artifactRevision: review.artifactRevision } : {}),
          ...(review.acceptanceCriteriaRevision ? { acceptanceCriteriaRevision: review.acceptanceCriteriaRevision } : {}),
        }],
      });
    };

    const boundId = await startSource("sourceBound", approveBound);
    const boundInspect = await s.dispatch("run.continuation.inspect", { id: boundId }) as {
      reusable: { nodeId: string; acceptanceCriteriaRevision?: string }[];
    };
    assert.equal(boundInspect.reusable.find(item => item.nodeId === "review")?.acceptanceCriteriaRevision, "c-1");
    await assert.rejects(
      continueReuse(boundId, "nextBound", true, { artifactRevision: "rev-1", acceptanceCriteriaRevision: "c-2" }, "cont-mismatch"),
      /different acceptance criteria/,
    );

    const openId = await startSource("sourceOpen", approveOnly);
    const continued = await continueReuse(
      openId, "nextOpen", false, { artifactRevision: "rev-1", acceptanceCriteriaRevision: "crit-2" }, "cont-open",
    ) as { id: string };
    const finished = await wait(c, continued.id, "succeeded");
    assert.deepEqual(finished.output, approveOnly);
    const reuseAct = c.store.listActivations(continued.id).find(item => item.kind === "reuse");
    assert.equal(reuseAct?.status, "succeeded");
    assert.deepEqual(reuseAct?.output, approveOnly);
    const persisted = finished.lineage?.receipt?.reused.find(item => item.bindingId === "verdict");
    assert.equal(persisted?.artifactRevision, "rev-1");
    assert.equal(persisted?.acceptanceCriteriaRevision, undefined);
    assert.deepEqual(c.store.listActivations(openId).find(item => item.context.nodeId === "review")?.output, approveOnly);
  } finally {
    for (const run of c.store.listRuns()) {
      try { await c.control(run.id, "cancel"); } catch { /* replaced lineage may refuse resume-like paths */ }
      const deadline = Date.now() + 8_000;
      while (!["succeeded", "failed", "cancelled", "paused"].includes(c.observe(run.id).run.status) && Date.now() < deadline) await sleep(40);
    }
    s.close(); c.close(); await rm(directory, { recursive: true, force: true });
  }
});
