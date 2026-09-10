import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { RunStore } from "../src/run-store.js";
import { WorkflowService } from "../src/service.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { parseOutputRepairProgress } from "../src/output-repair.js";

test("repair reports remain tied to the same attempt; progress is atomic, inspectable and archived on replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-repair-journal-")), filename = join(directory, "state.sqlite");
  const store = new RunStore(filename), service = new WorkflowService(filename), db = new DatabaseSync(filename);
  try {
    const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "repair", name: "Output repair", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [
      { id: "work", kind: "agent", role: "general", config: { outputRepair: { mode: "submit-only" } }, task: { op: "literal", value: "Offline" } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
    ], edges: [{ from: "work", to: "done" }] } } }, { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
    store.create({ id: "run-repair", plan, cwd: directory, input: null });
    const { token } = store.reserveLaunch("run-repair");
    const context = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 };
    const a = store.beginActivation("run-repair", token, context, { kind: "agent", sideEffect: false });
    store.startUsage("run-repair", token, a.key);
    store.recordUsage("run-repair", token, a.key, "1", { input: 2, output: 3, totalTokens: 5 }, "toolUse");
    const running = { round: 1, status: "running", cause: "schema", afterReport: 1, throughReport: 1 } as const;
    assert.deepEqual(parseOutputRepairProgress(running), running);
    db.exec("CREATE TRIGGER reject_repair_event BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.metadata' BEGIN SELECT RAISE(ABORT,'repair event rejected'); END");
    assert.throws(() => store.setActivationMetadata("run-repair", token, a.key, { outputRepair: running }), /event rejected/);
    assert.equal(store.getActivation("run-repair", a.key)!.metadata.outputRepair, undefined);
    db.exec("DROP TRIGGER reject_repair_event");
    store.setActivationMetadata("run-repair", token, a.key, { outputRepair: running });
    store.recordUsage("run-repair", token, a.key, "2", { input: 4, output: 6, totalTokens: 10 }, "toolUse");
    const invalid = { ...running, status: "invalid", throughReport: 2 } as const;
    store.setActivationMetadata("run-repair", token, a.key, { outputRepair: invalid });
    store.settleUsage("run-repair", token, a.key, true);
    store.failActivation("run-repair", token, a.key, "Invalid output");
    const viewer = await startGraphServer(filename, "run-repair");
    try {
      const snapshot = await (await fetch(viewer.url + "snapshot")).json() as any;
      assert.deepEqual(snapshot.graphs[0].nodes[0].activations[0].outputRepair, invalid);
      const attempts = await service.dispatch("run.attempts", { id: "run-repair", key: a.key }) as any;
      assert.equal(attempts.current.attempt, 1); assert.equal(attempts.archived, 0);
      assert.equal(attempts.current.accounting.responses, 2); assert.equal(attempts.current.accounting.usage.totalTokens, 15);
      assert.deepEqual(attempts.current.metadata.outputRepair, invalid);
      const events = store.events("run-repair").filter(e => e.type === "activation.metadata");
      assert.deepEqual(events.map(e => (e.payload as any).attempt), [1, 1]);
      assert.deepEqual(events.map(e => (e.payload as any).metadata.outputRepair.status), ["running", "invalid"]);
      store.beginActivation("run-repair", token, context, { kind: "agent", sideEffect: false });
      const page = store.attempts("run-repair", a.key);
      assert.equal(page.current.metadata.outputRepair, undefined);
      assert.deepEqual(page.records[0]!.metadata.outputRepair, invalid);
      assert.equal(page.records[0]!.accounting.usage!.totalTokens, 15);
    } finally { await viewer.close(); }
  } finally { db.close(); service.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("repair progress rejects malformed states, impossible report ranges and nonintegral rounds", () => {
  const valid = { round: 1, status: "running", cause: "missing", afterReport: 2, throughReport: 2 };
  for (const value of [null, { ...valid, round: 0 }, { ...valid, round: 1.1 }, { ...valid, throughReport: 1 }, { ...valid, status: "approve" }, { ...valid, cause: "provider" }, { ...valid, arbitrary: true }]) assert.equal(parseOutputRepairProgress(value), null);
});
