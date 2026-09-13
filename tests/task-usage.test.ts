import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { WorkflowService } from "../src/service.js";
import { RunController } from "../src/run-controller.js";
import { summarizeTaskUsage } from "../src/usage.js";
import type { PreparedExecution } from "../src/execution-types.js";
import type { Node } from "../src/graph.js";
import type { ActivationRecord } from "../src/run-store.js";

const models = [{ provider: "test", id: "frozen", thinkingLevels: ["off"] as const }];
const agent = (usage: ActivationRecord["metadata"], attempt = 1): ActivationRecord => ({
  runId: "r", key: "k", context: { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 },
  kind: "agent", sideEffect: true, status: "succeeded", attempt, ownerToken: "", startedAt: 0, finishedAt: 1, metadata: usage,
});
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

test("task aggregator counts each run once, reuse adds zero, and unknown cost stays partial", () => {
  const combined = summarizeTaskUsage([
    { id: "r1", records: [agent({ usage: { input: 10, output: 2, totalTokens: 12, cost: 1, cacheRead: 4 }, usageComplete: true, usageRecordedAttempts: 1, usageReportCount: 1 })] },
    { id: "r2", records: [agent({ usage: { input: 5, output: 5, totalTokens: 10 }, usageComplete: true, usageRecordedAttempts: 1, usageReportCount: 2 }, 2)] },
    { id: "r3", records: [{ ...agent({ reused: { invocation: false } }), kind: "reuse", sideEffect: false }], reusedOutputs: 1 },
  ]);
  assert.equal(combined.summary.totalTokens, 22);
  assert.equal(combined.summary.reported, 2);
  assert.equal(combined.reusedOutputs, 1);
  assert.equal(combined.summary.cost, 1);
  assert.equal(combined.summary.costPartial, true);
  assert.equal(combined.summary.cacheRead, 4);
  assert.equal(combined.summary.cacheReadPartial, true);
  assert.equal(combined.summary.earlierAttempts, 1);
  assert.equal(combined.sdkCostIsEstimate, true);
  assert.equal(combined.subscriptionInvoice, false);
  assert.equal(combined.unknownCostIsZero, false);
  const empty = summarizeTaskUsage([]);
  assert.equal(empty.summary.cost, 0);
  assert.equal(empty.unknownCostIsZero, false);
});

test("task.usage pages distinct linked-run reports without summing archives twice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-task-usage-")), filename = join(directory, "state.sqlite");
  const s = new WorkflowService(filename, { cwd: directory, availableModels: models }), c = new RunController(filename);
  try {
    const author = async (id: string, nodes: Node[]) => {
      await s.dispatch("workflow.create", { id, name: id });
      await s.dispatch("workflow.patch", { id, expectedRevision: 1, operations: [
        ...nodes.map(node => ({ op: "addNode", graphId: "main", node })),
        ...nodes.slice(1).map((node, index) => ({ op: "connect", graphId: "main", edge: { from: nodes[index]!.id, to: node.id } })),
      ] });
    };
    const startPure = async (id: string, key: string) => {
      await author(id, [{ id: "done", kind: "end", value: { op: "literal", value: { result: id } } }]);
      return s.dispatch("workflow.prepare", { id }) as Promise<PreparedExecution>;
    };
    const firstPlan = await startPure("orig", "u1");
    const first = await s.dispatch("run.start", { preparedId: firstPlan.preparedId, idempotencyKey: "u1", input: null }) as { id: string };
    await wait(c, first.id, "succeeded");
    const secondPlan = await startPure("two", "u2");
    const inspect = await s.dispatch("run.continuation.inspect", { id: first.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
    const second = await s.dispatch("run.continue", {
      preparedId: secondPlan.preparedId, idempotencyKey: "u2", input: null, actor: "t", reason: "link", evidence: ["n"],
      source: { runId: first.id, checkpoint: inspect.checkpoint, planHash: inspect.planHash }, workspaceDigest: inspect.workspace.digest, reuse: [],
    }) as { id: string };
    await wait(c, second.id, "succeeded");
    const thirdPlan = await startPure("three", "u3");
    const inspect2 = await s.dispatch("run.continuation.inspect", { id: second.id }) as { checkpoint: string; planHash: string; workspace: { digest: string } };
    const third = await s.dispatch("run.continue", {
      preparedId: thirdPlan.preparedId, idempotencyKey: "u3", input: null, actor: "t", reason: "third", evidence: ["n"],
      source: { runId: second.id, checkpoint: inspect2.checkpoint, planHash: inspect2.planHash }, workspaceDigest: inspect2.workspace.digest, reuse: [],
    }) as { id: string };
    await wait(c, third.id, "succeeded");
    const taskId = c.store.get(first.id).lineage!.taskId;
    const key = JSON.stringify([["graph", "main"], "main", "done", 0]);
    const db = new DatabaseSync(filename);
    try {
      for (const [runId, input, output] of [[first.id, 11, 2], [second.id, 5, 1], [third.id, 4, 4]] as const) {
        db.prepare("INSERT INTO workflow_usage_attempts(run_id,activation_key,attempt,complete) VALUES(?,?,1,1)").run(runId, key);
        db.prepare("INSERT INTO workflow_usage_reports(run_id,activation_key,attempt,report_id,usage,stop_reason,at) VALUES(?,?,1,'1',?, 'stop',?)")
          .run(runId, key, JSON.stringify({ input, output, totalTokens: input + output }), Date.now());
      }
    } finally { db.close(); }
    const page = await s.dispatch("task.usage", { id: taskId, after: 0, limit: 100 }) as { reports: { runId: string; reportId: string }[]; hasMore: boolean; reusedOutputs: number; runs: unknown[] };
    assert.equal(page.runs.length, 3);
    assert.equal(page.reports.length, 3);
    assert.equal(new Set(page.reports.map(item => item.runId)).size, 3);
    assert.equal(page.reusedOutputs, 0);
    const again = await s.dispatch("task.usage", { id: taskId, after: 0, limit: 100 }) as { reports: unknown[] };
    assert.equal(again.reports.length, 3);
  } finally {
    s.close(); c.close(); await rm(directory, { recursive: true, force: true });
  }
});
