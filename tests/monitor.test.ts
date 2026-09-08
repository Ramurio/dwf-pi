import assert from "node:assert/strict";
import test from "node:test";
import { activeWork, activationPath, clipLine, collectActivity, MonitorLog, monitorBody, renderDashboard } from "../src/monitor.js";
import type { ActivationRecord, RunEvent, RunRecord } from "../src/run-store.js";
import type { ExecutionPlan } from "../src/execution-types.js";

const run = (): RunRecord => ({ id: "run-demo", status: "running", desired: "running", createdAt: 0, updatedAt: 20_000, heartbeatAt: 20_000, cwd: "/tmp", input: null, ownerToken: null, supervisorPid: null,
  plan: { workflow: { id: "demo", name: "Demo", revision: 1, entryGraph: "main", graphs: {
    main: { entry: "candidate", nodes: [{ id: "candidate", kind: "worktree", graphId: "child", input: { op: "literal", value: null } }], edges: [] },
    child: { entry: "review", nodes: [{ id: "review", kind: "agent", role: "reviewer", task: { op: "literal", value: "review" } }], edges: [] },
  } }, agents: {} } as unknown as ExecutionPlan,
});
const activation = (id: string, kind: string, scope: string[], visit = 0): ActivationRecord => ({
  runId: "run-demo", key: JSON.stringify([id, scope, visit]), context: { graphId: id === "candidate" ? "main" : "child", nodeId: id, scope, visit },
  kind, sideEffect: true, status: "running", attempt: 1, ownerToken: "owner", startedAt: 0, finishedAt: null, metadata: {},
});
const base = ["graph", "main"];
const child = [...base, "node", "candidate", "visit", "0", "worktree", "graph", "child"];
const reviewer = (branch: string, visit = 0) => activation("review", "agent", [...child, "node", "council", "visit", "1", "parallel", branch, "graph", "child"], visit);

test("active tasks omit waiting containers, retain separate council branches and numbered passes", () => {
  const records = [activation("candidate", "worktree", base), activation("council", "parallel", child, 1), reviewer("correctness"), reviewer("tests"), reviewer("docs", 1)];
  assert.equal(activeWork(records).length, 3);
  const text = renderDashboard(run(), records, { now: 70_000, height: 24 });
  assert.match(text, /задач сейчас: 3/);
  assert.match(text, /council #2 \/ correctness \/ review · проход 1/);
  assert.match(text, /council #2 \/ docs \/ review · проход 2/);
  assert.doesNotMatch(text, /scope=|visit=|Graph main|recorded activations/);
  assert.equal(text.split("\n").length, 24);
});

test("map items, nested passes and recovery attempts retain distinct readable identities", () => {
  const a = activation("check", "check", [...child, "node", "items", "visit", "2", "map", "4", "graph", "child"], 3);
  a.attempt = 2;
  assert.match(activationPath(a), /items #3 \/ элемент 5 \/ check · проход 4 · попытка 2/);
});

test("view stays within viewport; scrolling reveals overflow and graph is opt-in", () => {
  const records = Array.from({ length: 40 }, (_, i) => reviewer(`branch-${i}`));
  for (const width of [20, 60, 100]) {
    const text = renderDashboard(run(), records, { width, height: 16 });
    assert.equal(text.split("\n").length, 16);
    assert.ok(text.split("\n").every(line => [...line].length <= width));
  }
  const body = monitorBody(run(), records);
  assert.ok(body.length > 80);
  assert.match(renderDashboard(run(), records, { offset: 68, height: 16 }), /branch-34/);
  assert.match(monitorBody(run(), records, { view: "graph" }).join("\n"), /Graph main/);
  assert.match(clipLine("界界界", 5), /^界界…$/);
  assert.doesNotMatch(clipLine("x\u001b[2J\n\u202ey", 100), /[\u001b\n\u202e]/);
});

test("history distinguishes business rejection and nonzero checks from completed execution", () => {
  const a = reviewer("tests"); a.status = "succeeded"; a.finishedAt = 5000; a.output = { decision: "request_changes" };
  const b = activation("tests", "check", child); b.status = "succeeded"; b.finishedAt = 6000; b.output = { exitCode: 1 };
  const r = run(); r.status = "succeeded"; r.output = { accepted: false };
  const text = renderDashboard(r, [a, b], { now: 999_000 });
  assert.match(text, /РЕЗУЛЬТАТ НЕ ПРИНЯТ/);
  assert.match(text, /request_changes/);
  assert.match(text, /exit 1/);
  assert.match(text, /20с/); // finished elapsed, not wall clock since launch
  assert.match(monitorBody(r, [a, b], { view: "history" }).join("\n"), /Проход = повтор узла/);
});

test("activity reports observed tools or waiting, never infers model thinking from silence", () => {
  const a = reviewer("tests"), activity = new Map();
  const e = (event: object, at: number): RunEvent => ({ seq: at, runId: "run-demo", type: "worker.event", at, payload: { key: a.key, event } as RunEvent["payload"] });
  collectActivity([e({ type: "tool_execution_start", toolName: "read" }, 1000)], activity);
  assert.match(renderDashboard(run(), [a], { activity, now: 6000 }), /инструмент read · 5с назад/);
  collectActivity([e({ type: "turn_start" }, 7000)], activity);
  assert.match(renderDashboard(run(), [a], { activity, now: 8000 }), /ожидание ответа модели · 1с назад/);
  const r = run(); r.status = "paused"; r.desired = "paused";
  assert.match(renderDashboard(r, [activation("candidate", "worktree", base)]), /контейнер на паузе/);
});

test("append-only mode emits each transition once and ignores heartbeat, metadata and clock ticks", () => {
  const log = new MonitorLog(), r = run(), a = reviewer("tests");
  assert.equal(log.update(r, [a]).length, 3);
  r.heartbeatAt = 9000; a.metadata.workerPid = 99;
  assert.deepEqual(log.update(r, [a]), []);
  a.status = "succeeded"; a.finishedAt = 10_000; a.output = { decision: "approve" };
  assert.equal(log.update(r, [a]).length, 1);
  assert.deepEqual(log.update(r, [a]), []);
  const again = reviewer("tests", 1);
  assert.match(log.update(r, [a, again]).join("\n"), /проход 2/);
});

test("attaching to a long run shows recent results rather than dumping all prior iterations", () => {
  const records = Array.from({ length: 200 }, (_, i) => { const a = reviewer("tests", i); a.status = "succeeded"; a.finishedAt = i + 1; return a; });
  const log = new MonitorLog();
  const lines = log.update(run(), records);
  assert.equal(lines.length, 7);
  assert.match(lines.join("\n"), /проход 200/);
  assert.doesNotMatch(lines.join("\n"), /проход 1 —/);
  assert.deepEqual(log.update(run(), records), []);
});

test("very small windows preserve a visible exit hint without overflowing rows", () => {
  for (const height of [4, 6, 9]) {
    const text = renderDashboard(run(), [reviewer("tests")], { height, width: 60 });
    assert.equal(text.split("\n").length, height);
    assert.match(text.split("\n").at(-1)!, /q выход/);
  }
});
