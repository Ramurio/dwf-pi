import assert from "node:assert/strict";
import test from "node:test";
import { projectRun, activationState } from "../src/observation.js";
import type { RunRecord, ActivationRecord } from "../src/run-store.js";
import { graphSnapshot } from "../src/graph-view/model.js";
import { renderDashboard, MonitorLog } from "../src/monitor.js";
import { renderRun } from "../src/terminal.js";

const run = (status: RunRecord["status"] = "running"): RunRecord => ({ id: "run-observation", status, desired: "running", cwd: "/tmp", input: null,
  ownerToken: "PRIVATE", supervisorPid: 4321, createdAt: 0, updatedAt: 0, heartbeatAt: 0,
  plan: { version: 1, runtimeVersion: "dynamicwf-runtime-v2", compilerVersion: "dynamicwf-effect-v2", source: "", sourceHash: "", hash: "", agents: {},
    workflow: { schemaVersion: 1, id: "observation", revision: 1, name: "Observation", entryGraph: "main", graphs: { main: { entry: "answer", nodes: [], edges: [] } } } },
});
const wait = (): ActivationRecord => ({ key: "wait-key", runId: "run-observation", kind: "await", status: "running", sideEffect: false,
  ownerToken: "PRIVATE", attempt: 1, startedAt: 0, finishedAt: null, context: { scope: ["graph", "main"], graphId: "main", nodeId: "answer", visit: 0 },
  metadata: { waiting: true, waitId: "wait-one", waitReason: "Need evidence" },
});

test("process facts remain separate from heartbeat, task outcome and operator intent", () => {
  const record = run("waiting");
  const unknown = projectRun(record, []);
  assert.equal(unknown.liveness.state, "unknown"); assert.equal(unknown.liveness.supervisorAlive, null);
  for (const [supervisorAlive, workersAlive, launchPending, expected] of [
    [true, 0, false, "supervised"], [false, 2, false, "orphaned-workers"], [false, 0, true, "launching"], [false, 0, false, "stopped"],
  ] as const) {
    const projected = projectRun(record, [], { supervisorAlive, workersAlive, launchPending, observedAt: 100 });
    assert.equal(projected.liveness.state, expected); assert.equal(projected.status, "waiting");
    assert.equal(projected.taskOutcome, null); assert.equal(projected.liveness.observedAt, 100);
    assert.deepEqual(projectRun({ ...record, heartbeatAt: Date.now() }, [], { supervisorAlive, workersAlive, launchPending, observedAt: 100 }), projected);
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|4321/);
  }
});

test("waiting and pause counts agree across terminal and graph; evidence is not an activity", () => {
  const record = run("waiting"), activation = wait();
  const view = projectRun(record, [activation], { supervisorAlive: true, workersAlive: 0, launchPending: false, observedAt: 100 });
  assert.equal(activationState(activation), "waiting");
  assert.deepEqual(view.activeKeys, []); assert.deepEqual(view.waitingKeys, [activation.key]);
  assert.deepEqual(graphSnapshot(record, [activation], new Map(), [], view).presentation, view);
  assert.match(renderDashboard(record, [activation], { presentation: view, width: 200, height: 25 }), /ЖДЁТ ОТВЕТА.*задач сейчас: 0/);
  assert.match(renderRun(record, [activation], view), /1 waiting/);
  assert.doesNotMatch(renderRun(record, [activation], view), /Running activations:/);
  const log = new MonitorLog();
  assert.ok(log.update(record, [activation], view).some(line => line.includes("Need evidence") && line.includes("wait-one")));
  assert.deepEqual(log.update(record, [activation], view), []);
  const parent = { ...activation, kind: "map", key: "parent", metadata: {} };
  assert.deepEqual(projectRun({ ...record, status: "paused", desired: "paused" }, [parent]).activeKeys, []);
});

test("legacy and explicit acceptance produce one decision; read-only observation changes do not spam logs", () => {
  const record = { ...run("succeeded"), output: { accepted: false } };
  const view = projectRun(record, [], { supervisorAlive: false, workersAlive: 0, launchPending: false, observedAt: 1 });
  assert.equal(view.taskOutcome?.decision, "rejected"); assert.equal(view.accepted, false);
  assert.equal(graphSnapshot(record, []).accepted, false);
  assert.match(renderRun(record, []), /Task: rejected/);
  assert.equal(projectRun({ ...record, taskOutcome: { decision: "accepted", source: "explicit", reason: "Root policy", evidence: [] } }, []).accepted, true);
  assert.equal(projectRun({ ...record, output: { result: "anything" } }, []).taskOutcome?.decision, "unclassified");
  const log = new MonitorLog();
  assert.ok(log.update(record, [], view).some(line => line.includes("Task: rejected")));
  assert.deepEqual(log.update(record, [], { ...view, liveness: { ...view.liveness, observedAt: 2 } }), []);
});

test("pending retry remains visible beside a wait and after recent history has advanced", () => {
  const record = run(), waiting = wait();
  const parent: ActivationRecord = { ...waiting, key: "parent", kind: "parallel", context: { ...waiting.context, nodeId: "fan" }, metadata: {} };
  const retry: ActivationRecord = { ...waiting, key: "retry-key", kind: "check", status: "failed", finishedAt: 1,
    context: { ...waiting.context, nodeId: "command", scope: ["graph", "main", "node", "fan", "visit", "0", "parallel", "check", "graph", "child"] },
    metadata: { retry: { decisionSeq: 1, attempt: 1, nextAttempt: 2, scheduledAt: 1, delayMs: 60000, dueAt: 60001, status: "scheduled" } } };
  const recent: ActivationRecord[] = Array.from({ length: 8 }, (_, i) => ({ ...waiting, key: `done-${i}`, kind: "agent", status: "succeeded", finishedAt: 10 + i, metadata: {}, output: null }));
  record.plan.workflow.graphs.main!.nodes.push({ id: "command", kind: "check", command: "/unused", args: [] });
  recent[0] = { ...recent[0]!, kind: "check", context: { ...retry.context, scope: ["another-branch"] } };
  const records = [parent, waiting, retry, ...recent], view = projectRun(record, records);
  assert.deepEqual(view.activeKeys, []); assert.deepEqual(view.waitingKeys, [waiting.key]); assert.deepEqual(view.retryingKeys, [retry.key]);
  assert.equal(activationState(retry), "retrying");
  assert.deepEqual(graphSnapshot(record, records, new Map(), [], view).presentation, view);
  assert.equal(graphSnapshot(record, records).graphs[0]!.nodes.find(n => n.id === "command")!.status, "retrying");
  assert.match(renderDashboard(record, records, { now: 1000, height: 30, width: 180 }), /запланирована попытка 2/);
  assert.match(renderRun(record, records, view), /1 retrying/);
  const log = new MonitorLog();
  assert.match(log.update(record, records, view).join("\n"), /запланирована попытка 2/);
  assert.deepEqual(log.update({ ...record, heartbeatAt: 5000 }, records), []);
  const paused = { ...record, status: "paused", desired: "paused" } as RunRecord;
  assert.deepEqual(projectRun(paused, records).retryingKeys, [retry.key]);
  assert.match(renderDashboard(paused, records, { now: 70000, height: 30, width: 180 }), /допуск ожидает продолжения запуска/);
  assert.deepEqual(projectRun({ ...record, status: "cancelled" }, records).retryingKeys, []);
});
