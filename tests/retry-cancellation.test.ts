import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RunStore, type ActivationRecord, type RunRecord } from "../src/run-store.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { executionFailure } from "../src/execution-failure.js";
import { graphSnapshot } from "../src/graph-view/model.js";
import { MonitorLog, renderDashboard } from "../src/monitor.js";
import { projectRun } from "../src/observation.js";
import { renderRun } from "../src/terminal.js";

async function fixture(work: (store: RunStore, filename: string, key: string, token: string) => void) {
  const directory = await mkdtemp(join(tmpdir(), "retry-cancellation-"));
  const filename = join(directory, "state.sqlite"), store = new RunStore(filename);
  try {
    const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "retry-fixture", name: "Retry cancellation", revision: 1, entryGraph: "main", graphs: {
      main: { entry: "work", nodes: [
        { id: "work", kind: "check", command: "never-executed", args: [], retryPolicy: { codes: ["process"], delayMs: 60000 } },
        { id: "done", kind: "end", value: { op: "literal", value: null } },
      ], edges: [{ from: "work", to: "done" }] },
    } }, { cwd: directory, availableModels: [] });
    store.create({ id: "run", plan, cwd: directory, input: null });
    const { token } = store.reserveLaunch("run");
    const { key } = store.beginActivation("run", token, { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 }, { kind: "check", sideEffect: true });
    store.failActivation("run", token, key, "Safe setup failure", executionFailure("process", "setup", "not-started", "Safe setup failure").failure, { retryEligible: true });
    assert.ok(store.scheduledRetry("run", key));
    work(store, filename, key, token);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

function noPending(run: RunRecord, records: ActivationRecord[]) {
  assert.deepEqual(projectRun(run, records).retryingKeys, []);
  const node = graphSnapshot(run, records).graphs[0]!.nodes.find(n => n.id === "work")!;
  assert.equal(node.status, "failed");
  assert.equal(node.activations[0]!.status, "failed");
  const output = [renderRun(run, records), renderDashboard(run, records, { width: 180, height: 30 }), new MonitorLog().update(run, records).join("\n")].join("\n");
  assert.doesNotMatch(output, /retrying|Pending retries|запланирована попытка|↻/);
}

for (const cancelling of [false, true]) test(`ownerless cancellation abandons retry atomically (cancel already requested: ${cancelling})`, async () => fixture((store, filename, key, token) => {
  if (cancelling) store.requestControl("run", "cancel");
  store.markInterrupted("run", token, "Fixture supervisor is gone; no worker was launched");
  const decisions = store.retries("run", key).records;
  const snapshot = () => ({ run: store.get("run"), records: store.listActivations("run"), events: store.events("run") });
  const before = snapshot();
  const database = new DatabaseSync(filename);
  try {
    database.exec("CREATE TRIGGER reject_abandon BEFORE INSERT ON workflow_run_events WHEN NEW.type='retry.abandoned' BEGIN SELECT RAISE(ABORT, 'injected retry abandonment failure'); END");
    assert.throws(() => store.requestControl("run", "cancel"), /injected retry abandonment failure/);
    assert.deepEqual(snapshot(), before);
    database.exec("DROP TRIGGER reject_abandon");
    assert.equal(store.requestControl("run", "cancel").status, "cancelled");
    assert.equal(store.scheduledRetry("run", key), undefined);
    assert.equal((store.getActivation("run", key)!.metadata.retry as { status: string }).status, "abandoned");
    assert.deepEqual(store.retries("run", key).records, decisions);
    assert.equal(store.events("run").filter(e => e.type === "retry.abandoned").length, 1);
    const after = snapshot();
    store.requestControl("run", "cancel");
    assert.deepEqual(snapshot(), after);
    noPending(after.run, after.records);
  } finally { database.close(); }
}));

test("pause and interruption preserve the saved retry", async () => fixture((store, _filename, key, token) => {
  const decision = store.scheduledRetry("run", key);
  store.requestControl("run", "pause"); store.markPaused("run", token);
  assert.deepEqual(store.scheduledRetry("run", key), decision);
  store.markInterrupted("run", token, "Fixture stopped");
  assert.deepEqual(store.scheduledRetry("run", key), decision);
  assert.deepEqual(projectRun(store.get("run"), store.listActivations("run")).retryingKeys, [key]);
  assert.equal(store.events("run").filter(e => e.type === "retry.abandoned").length, 0);
}));

test("legacy terminal snapshots and stale attempts never promise another retry", async () => fixture((store, _filename, _key, _token) => {
  const run = store.get("run"), records = store.listActivations("run"), before = structuredClone(records);
  for (const status of ["succeeded", "failed", "cancelled"] as const) {
    const terminal = { ...run, status };
    noPending(terminal, records);
    const log = new MonitorLog();
    assert.match(log.update(run, records).join("\n"), /запланирована попытка/);
    assert.doesNotMatch(log.update(terminal, records).join("\n"), /запланирована попытка|↻/);
  }
  noPending(run, records.map(a => ({ ...a, attempt: a.attempt + 1 })));
  assert.deepEqual(records, before);
}));
