import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graphSnapshot } from "../src/graph-view/model.js";
import { MonitorLog, monitorBody, renderDashboard } from "../src/monitor.js";
import { projectRun } from "../src/observation.js";
import type { ExecutionPlan } from "../src/execution-types.js";
import type { ActivationRecord, RunRecord } from "../src/run-store.js";

const cwd = join(tmpdir(), "dynamicwf-campaign-collect");
const failure = { version: 1 as const, code: "process" as const, phase: "execution" as const, effects: "unknown" as const, message: "writer killed" };
const plan = {
  version: 1, runtimeVersion: "dynamicwf-runtime-v2", compilerVersion: "dynamicwf-effect-v5", source: "", sourceHash: "", hash: "", agents: {},
  workflow: { schemaVersion: 1, id: "collect-overview", name: "Collect overview", revision: 1, entryGraph: "main", graphs: {
    main: { entry: "council", nodes: [
      { id: "council", kind: "parallel", failurePolicy: "collect", children: [
        { id: "broken", graphId: "broken", input: { op: "literal", value: null } },
        { id: "nested", graphId: "nested", input: { op: "literal", value: null } },
      ] },
      { id: "done", kind: "finish", decision: "inconclusive", reason: { op: "literal", value: "One branch failed" }, evidence: { op: "literal", value: [] }, value: { op: "ref", path: ["nodes", "council"] } },
    ], edges: [{ from: "council", to: "done" }] },
    broken: { entry: "write", nodes: [{ id: "write", kind: "check", command: "true", args: [] }], edges: [] },
    nested: { entry: "map", nodes: [{ id: "map", kind: "map", graphId: "item", failurePolicy: "collect", items: { op: "literal", value: [1, 2] } }], edges: [] },
    item: { entry: "value", nodes: [{ id: "value", kind: "end", value: { op: "ref", path: ["input"] } }], edges: [] },
    clean: { entry: "fan", nodes: [{ id: "fan", kind: "parallel", failurePolicy: "collect", children: [
      { id: "left", graphId: "item", input: { op: "literal", value: 1 } }, { id: "right", graphId: "item", input: { op: "literal", value: 2 } },
    ] }], edges: [] },
  } },
} as unknown as ExecutionPlan;

function run(id: string, status: RunRecord["status"] = "succeeded", extra: Partial<RunRecord> = {}): RunRecord {
  return { id, status, desired: "running", createdAt: 0, updatedAt: 20, heartbeatAt: 20, cwd, input: null, ownerToken: null, supervisorPid: null, plan, ...extra };
}
function activation(runId: string, nodeId: string, graphId: string, kind: string, scope: string[], extra: Partial<ActivationRecord> = {}): ActivationRecord {
  return {
    runId, key: JSON.stringify([graphId, nodeId, scope]), context: { graphId, nodeId, scope, visit: 0 },
    kind, sideEffect: kind === "check", status: "succeeded", attempt: 1, ownerToken: "owner", startedAt: 1, finishedAt: 2, metadata: {}, ...extra,
  };
}
function nodeOf(snapshot: ReturnType<typeof graphSnapshot>, graphId: string, nodeId: string) {
  return snapshot.graphs.find(graph => graph.id === graphId)?.nodes.find(node => node.id === nodeId);
}

test("mixed collect keeps technical parent success while overview surfaces failed child counts, nested branches and leaf errors", () => {
  const mixed = run("run-mixed", "succeeded", { taskOutcome: { decision: "inconclusive", reason: "One branch failed", evidence: [], source: "explicit" } });
  const parent = activation("run-mixed", "council", "main", "parallel", ["graph", "main"], {
    output: {
      broken: { status: "failed", failure },
      nested: { status: "succeeded", value: [{ status: "succeeded", value: 1 }, { status: "failed", failure }] },
    },
    metadata: { collectionSummary: { total: 2, succeeded: 1, failed: 1 } },
  });
  const nested = activation("run-mixed", "map", "nested", "map", ["graph", "main", "node", "council", "visit", "0", "parallel", "nested", "graph", "nested"], {
    output: [{ status: "succeeded", value: 1 }, { status: "failed", failure }],
    metadata: { collectionSummary: { total: 2, succeeded: 1, failed: 1 } },
  });
  const leaf = activation("run-mixed", "write", "broken", "check", ["graph", "main", "node", "council", "visit", "0", "parallel", "broken", "graph", "broken"], {
    status: "failed", error: "writer killed", metadata: { failure },
  });
  const records = [parent, nested, leaf];
  const presentation = projectRun(mixed, records);
  assert.equal(parent.status, "succeeded");
  assert.equal(nested.status, "succeeded");
  assert.equal(presentation.taskOutcome?.decision, "inconclusive");
  assert.equal(presentation.accepted, null);
  assert.equal(parent.metadata.retry, undefined);
  assert.equal(leaf.metadata.retry, undefined);
  const overview = monitorBody(mixed, records).join("\n");
  const history = monitorBody(mixed, records, { view: "history" }).join("\n");
  assert.match(overview, /!.*собрано: 2.*ошибок: 1/);
  assert.match(history, /!.*собрано: 2.*ошибок: 1/);
  const dashboard = renderDashboard(mixed, records, { now: 10_000, height: 36, width: 160 });
  assert.match(dashboard, /ЗАВЕРШЁН/);
  assert.match(dashboard, /НЕДОСТАТОЧНО ДАННЫХ ДЛЯ ПРИЁМКИ/);
  assert.doesNotMatch(dashboard, /DYNAMICWF  ОШИБКА/);
  const log = new MonitorLog();
  assert.match(log.update(mixed, records, presentation).join("\n"), /собрано: 2.*ошибок: 1/);
  assert.doesNotMatch(log.update(mixed, records, presentation).join("\n"), /запланирована попытка/);
  const snapshot = graphSnapshot(mixed, records);
  const council = nodeOf(snapshot, "main", "council")!;
  const map = nodeOf(snapshot, "nested", "map")!;
  const write = nodeOf(snapshot, "broken", "write")!;
  assert.equal(council.status, "succeeded");
  assert.equal(council.failurePolicy, "collect");
  assert.equal(council.activations[0]!.status, "succeeded");
  assert.equal(council.activations[0]!.retry, null);
  assert.equal(council.activations[0]!.failure, null);
  assert.match(council.activations[0]!.result ?? "", /собрано: 2 · успешно: 1 · ошибок: 1/);
  assert.equal(map.status, "succeeded");
  assert.equal(map.failurePolicy, "collect");
  assert.match(map.activations[0]!.result ?? "", /собрано: 2 · успешно: 1 · ошибок: 1/);
  assert.equal(write.status, "failed");
  assert.equal(write.activations[0]!.failure?.code, "process");
  assert.match(write.activations[0]!.error ?? "", /writer killed/);
});

test("all-success collect stays a clean success in terminal and browser overview", () => {
  const ok = run("run-clean");
  const fan = activation("run-clean", "fan", "clean", "parallel", ["graph", "clean"], {
    output: { left: { status: "succeeded", value: 1 }, right: { status: "succeeded", value: 2 } },
    metadata: { collectionSummary: { total: 2, succeeded: 2, failed: 0 } },
  });
  const records = [fan];
  const line = monitorBody(ok, records).find(text => text.includes("собрано:")) ?? "";
  assert.match(line, /^✓/);
  assert.match(line, /собрано: 2 · успешно: 2 · ошибок: 0/);
  assert.doesNotMatch(line, /ошибок: [1-9]/);
  const snapshot = graphSnapshot(ok, records);
  const node = nodeOf(snapshot, "clean", "fan")!;
  assert.equal(node.status, "succeeded");
  assert.equal(node.failurePolicy, "collect");
  assert.equal(node.activations[0]!.retry, null);
  assert.match(node.activations[0]!.result ?? "", /собрано: 2 · успешно: 2 · ошибок: 0/);
  assert.doesNotMatch(node.activations[0]!.result ?? "", /ошибок: [1-9]/);
  assert.equal(projectRun(ok, records).taskOutcome?.decision, "unclassified");
});
