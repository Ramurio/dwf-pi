import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunController } from "../src/run-controller.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { executionFailure } from "../src/execution-failure.js";
import type { WorkflowDefinition } from "../src/graph.js";
import type { ReconciliationRequest } from "../src/reconciliation.js";

for (const action of ["retry", "accept"] as const) test(`${action} replaces only selected automatic authorization after interruption`, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "retry-reconcile-")));
  const c = new RunController(join(directory, "state.sqlite")), s = c.store, id = "run-fixture";
  const context = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 };
  try {
    const workflow: WorkflowDefinition = { schemaVersion: 1, id: "fixture", name: "Offline", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Never invoked" }, retryPolicy: { codes: ["process"], delayMs: 60000 } },
      { id: "done", kind: "end", value: { op: "literal", value: null } },
    ], edges: [{ from: "work", to: "done" }] } } };
    const plan = await prepareExecutionPlan(workflow, { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
    s.create({ id, plan, cwd: directory, input: null });
    const { token } = s.reserveLaunch(id);
    const keys: string[] = [];
    for (const visit of [0, 1]) {
      const a = s.beginActivation(id, token, { ...context, visit }, { kind: "agent", sideEffect: true }); keys.push(a.key);
      s.setActivationMetadata(id, token, a.key, { operation: { kind: "agent", cwd: directory, task: "Never invoked", input: null, sessionDirectory: directory, resourceDirectory: directory } });
      s.startUsage(id, token, a.key);
      s.recordUsage(id, token, a.key, "1", { input: 7, output: 3, totalTokens: 10 }, "error");
      s.settleUsage(id, token, a.key, true);
      s.failActivation(id, token, a.key, "Safe setup failure", executionFailure("process", "setup", "not-started", "Safe setup failure").failure, { retryEligible: true });
    }
    const [key, other] = keys as [string, string], history = s.retries(id, key).records, second = s.scheduledRetry(id, other);
    s.markInterrupted(id, token, "Simulated dead supervisor; no workers spawned");
    assert.deepEqual(s.scheduledRetry(id, key), history[0]);
    assert.equal(s.events(id).filter(e => e.type === "retry.abandoned").length, 0);
    const request = async (decisionId: string): Promise<ReconciliationRequest> => {
      const r = await c.recovery(id, key); assert.deepEqual(r.blockers, []); assert.ok(r.workspace);
      return { id, key, attempt: r.attempt, checkpoint: r.checkpoint, workspaceDigest: r.workspace.digest, decisionId, action, actor: "offline-test", reason: "Inspected setup failure", evidence: [{ inspected: true }], ...(action === "accept" ? { output: { result: "Accepted offline" } } : {}) };
    };
    const r = await request("first"), receipt = await c.reconcile(r), count = s.events(id).length;
    assert.deepEqual(await c.reconcile(r), receipt); assert.equal(s.events(id).length, count);
    assert.equal(s.scheduledRetry(id, key), undefined);
    assert.deepEqual(s.scheduledRetry(id, other), second);
    assert.ok(!c.snapshot(id).presentation.retryingKeys.includes(key));
    assert.ok(c.snapshot(id).presentation.retryingKeys.includes(other));
    assert.deepEqual(s.retries(id, key).records, history);
    const removed = s.events(id).filter(e => e.type === "retry.abandoned");
    assert.equal(removed.length, 1);
    assert.equal((removed[0]!.payload as { reason: string }).reason, "reconciled");
    if (action === "retry") {
      assert.equal(s.getActivation(id, key)!.attempt, 1);
      assert.equal(s.reconciliations(id, key).filter(r => !r.application && !r.supersededBy).length, 1);
      const fresh = await request("second");
      await assert.rejects(c.reconcile(fresh), /explicit supersedes/);
      const next = { ...fresh, supersedes: r.decisionId }; await c.reconcile(next);
      assert.equal(s.reconciliation(id, r.decisionId)!.supersededBy, next.decisionId);
      const owner = s.reserveLaunch(id).token;
      assert.equal(s.beginActivation(id, owner, context, { kind: "agent", sideEffect: true, reconciliation: next.decisionId }).attempt, 2);
      s.failActivation(id, owner, key, "Uncertain second attempt");
      assert.throws(() => s.beginActivation(id, owner, context, { kind: "agent", sideEffect: true, reconciliation: next.decisionId }), /no longer pending/);
      s.requestControl(id, "cancel"); s.finish(id, owner, { status: "cancelled" });
    } else {
      const a = s.attempts(id, key);
      assert.equal(a.current.attempt, 2); assert.equal(a.current.metadata.usageComplete, true);
      assert.equal((a.current.metadata.usage as { totalTokens: number }).totalTokens, 10);
      assert.equal(a.records[0]!.accounting.usage!.totalTokens, 10);
      assert.equal(s.pendingReconciliation(id, key), undefined);
      const owner = s.reserveLaunch(id).token; s.finish(id, owner, { status: "failed", error: "Fixture terminal" });
    }
    assert.equal((s.attempts(id, key).records[0]!.metadata.retry as { status: string }).status, "abandoned");
    const abandoned = s.events(id).filter(e => e.type === "retry.abandoned");
    assert.equal(abandoned.length, 2);
    assert.equal(s.events(id).filter(e => e.type === "retry.admitted").length, 0);
    assert.equal(s.scheduledRetry(id, other), undefined);
    assert.deepEqual(s.retries(id, key).records, history);
  } finally { c.close(); await rm(directory, { recursive: true, force: true }); }
});
