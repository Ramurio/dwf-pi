import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RunStore } from "../src/run-store.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { summarizeUsage, summarizeTaskUsage } from "../src/usage.js";
// The existing accept regression is deliberately retained unchanged: no model invocation.
import "./wave5-d03.test.js";

const flow = { schemaVersion: 1, id: "legacy", name: "legacy", revision: 1, entryGraph: "main", graphs: { main: { entry: "done", nodes: [{ id: "done", kind: "end", value: { op: "literal", value: null } }], edges: [] } } };
const context = { graphId: "main", nodeId: "done", scope: ["graph", "main"], visit: 0 };
for (const mode of ["normal", "mixed", "unknown", "overlap", "missing-attempts"] as const) test(`legacy baseline: ${mode}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "legacy-usage-")), filename = join(directory, "state.sqlite");
  let store = new RunStore(filename);
  try {
    const plan = await prepareExecutionPlan(flow, { cwd: directory, availableModels: [] });
    store.create({ id: "r", plan, cwd: directory, input: null });
    const { token } = store.reserveLaunch("r");
    const a = store.beginActivation("r", token, context, { kind: "agent", sideEffect: false });
    store.setActivationMetadata("r", token, a.key, { usage: { input: 70, output: 30, totalTokens: 100, cost: 2, cacheRead: 5 } });
    if (mode === "missing-attempts") {
      const db = new DatabaseSync(filename);
      db.exec("UPDATE workflow_activations SET attempt=4"); db.close();
    }
    if (mode !== "unknown") {
      store.failActivation("r", token, a.key, "legacy failure");
      store.beginActivation("r", token, context, { kind: "agent", sideEffect: false });
    }
    if (mode === "unknown" || mode === "overlap" || mode === "mixed") {
      const db = new DatabaseSync(filename);
      if (mode === "unknown") db.exec("DELETE FROM workflow_activation_history");
      if (mode === "overlap") db.prepare("INSERT INTO workflow_usage_attempts(run_id,activation_key,attempt,complete) VALUES(?,?,1,1)").run("r", a.key);
      if (mode === "mixed") store.setActivationMetadata("r", token, a.key, { usageLedgerVersion: 1, usage: { input: 15, output: 5, totalTokens: 20 } });
      db.close();
    }
    const expected = mode === "unknown" || mode === "overlap" ? 20 : 120;
    const report = { input: 15, output: 5, totalTokens: 20, cacheWrite: 3 };
    for (let i = 0; i < 2; i++) {
      store.startUsage("r", token, a.key);
      store.recordUsage("r", token, a.key, "1", report, "stop");
      store.settleUsage("r", token, a.key, true);
    }
    assert.equal(store.usageReports("r").reports.length, 1);
    assert.equal(summarizeUsage(store.listActivations("r")).totalTokens, expected);
    store.close(); store = new RunStore(filename);
    store.settleUsage("r", token, a.key, true);
    store.failActivation("r", token, a.key, "retry");
    store.beginActivation("r", token, context, { kind: "agent", sideEffect: false });
    store.startUsage("r", token, a.key);
    store.recordUsage("r", token, a.key, "1", report, "stop");
    store.settleUsage("r", token, a.key, true);
    store.completeActivation("r", token, a.key, null);
    const records = store.listActivations("r"), summary = summarizeUsage(records);
    assert.equal(summary.totalTokens, expected + 20);
    assert.equal(summary.responses, 2);
    assert.equal(summary.partial, true);
    assert.equal(records[0]!.metadata.usageLegacyIncomplete, true);
    if (mode === "unknown" || mode === "overlap") assert.equal(summary.earlierAttempts, 0);
    if (expected === 120) {
      assert.equal(summary.partial, true);
      assert.ok(summary.earlierAttempts > 0);
      assert.equal(summary.cost, 2);
      assert.equal(summary.costPartial, true);
      assert.equal(summary.cacheReadPartial, true);
      assert.equal(summary.cacheWritePartial, true);
      assert.equal((records[0]!.metadata.usageLegacyBaseline as any).throughAttempt, mode === "missing-attempts" ? 4 : 1);
    }
    const task = summarizeTaskUsage([{ id: "r", records }, { id: "reuse", records: [{ ...records[0]!, kind: "reuse" }] }]);
    assert.equal(task.summary.totalTokens, expected + 20);
    assert.equal(task.reusedOutputs, 1);
    assert.equal(task.summary.partial, true);
    assert.equal(task.subscriptionInvoice, false);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

// Exercise the actual reconciliation path with a proven legacy boundary.
for (const mode of ["baseline", "unknown", "overlap"] as const) test(`legacy ${mode} survives accept without a new response`, async () => {
  const { RunController } = await import("../src/run-controller.js");
  const directory = await mkdtemp(join(tmpdir(), "legacy-accept-"));
  const filename = join(directory, "state.sqlite"), controller = new RunController(filename);
  try {
    const workflow = { ...flow, graphs: { main: { entry: "done", nodes: [{ id: "done", kind: "agent", role: "general", task: { op: "literal", value: "offline" }, config: { outputSchema: { type: "object" } } }, { id: "end", kind: "end", value: { op: "literal", value: null } }], edges: [{ from: "done", to: "end" }] } } };
    const plan = await prepareExecutionPlan(workflow, { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
    const store = controller.store;
    store.create({ id: "accept", plan, cwd: directory, input: null });
    const { token } = store.reserveLaunch("accept");
    const a = store.beginActivation("accept", token, context, { kind: "agent", sideEffect: true });
    // Simulate a migrated checkpoint with its immutable pre-ledger archive.
    const legacy = { ...a, status: "failed", metadata: { usage: { input: 70, output: 30, totalTokens: 100 } } };
    const db = new DatabaseSync(filename);
    if (mode !== "unknown") db.prepare("INSERT INTO workflow_activation_history(run_id,activation_key,attempt,record) VALUES(?,?,1,?)").run("accept", a.key, JSON.stringify(legacy));
    if (mode !== "unknown") db.exec("UPDATE workflow_activations SET attempt=2");
    if (mode === "overlap") db.prepare("INSERT INTO workflow_usage_attempts(run_id,activation_key,attempt,complete) VALUES(?,?,1,1)").run("accept", a.key);
    db.close();
    if (mode === "unknown") store.setActivationMetadata("accept", token, a.key, legacy.metadata);
    store.setActivationMetadata("accept", token, a.key, { operation: { kind: "agent", cwd: directory, task: "offline", input: null, sessionDirectory: directory, resourceDirectory: directory } });
    store.startUsage("accept", token, a.key);
    store.recordUsage("accept", token, a.key, "1", { input: 15, output: 5, totalTokens: 20 }, "error");
    store.settleUsage("accept", token, a.key, true);
    const before = store.getActivation("accept", a.key)!.metadata;
    store.requestControl("accept", "pause");
    store.failActivation("accept", token, a.key, "uncertain");
    store.finish("accept", token, { status: "failed", error: "uncertain" });
    const inspected = await controller.recovery("accept", a.key);
    assert.deepEqual(inspected.blockers, []);
    await controller.reconcile({ id: "accept", key: a.key, attempt: inspected.attempt, checkpoint: inspected.checkpoint, workspaceDigest: inspected.workspace!.digest, decisionId: "accept-legacy", action: "accept", actor: "fixture", reason: "inspected", evidence: [{ inspected: true }], output: {} });
    const after = store.getActivation("accept", a.key)!.metadata;
    assert.deepEqual(after.usageLegacyBaseline, before.usageLegacyBaseline);
    assert.deepEqual(after.usage, before.usage);
    assert.equal(after.usageComplete, false);
    assert.equal(after.usageLegacyIncomplete, true);
    assert.equal(summarizeUsage(store.listActivations("accept")).partial, true);
    assert.equal(after.usageReportCount, 1);
    assert.equal(summarizeUsage(store.listActivations("accept")).totalTokens, mode === "baseline" ? 120 : 20);
    assert.equal(store.usageReports("accept").reports.length, 1);
  } finally { controller.close(); await rm(directory, { recursive: true, force: true }); }
});
