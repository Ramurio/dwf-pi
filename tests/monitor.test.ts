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

test("a collected branch failure remains visible when its container succeeds and progress is not duplicated",()=>{
  const record=activation('council','parallel',base),current=run(),log=new MonitorLog();
  record.metadata.collectionSummary={total:1,succeeded:0,failed:1};
  assert.match(log.update(current,[record]).join('\n'),/собрано: 1.*ошибок: 1/);assert.deepEqual(log.update(current,[record]),[]);
  record.metadata.collectionSummary={total:2,succeeded:1,failed:1};record.status='succeeded';record.finishedAt=100;
  assert.match(monitorBody(current,[record],{view:'history'}).join('\n'),/!.*собрано: 2.*ошибок: 1/);
});

test("repair progress is visible without new activation attempts and clock polling does not duplicate it", () => {
  const record = reviewer("format"), current = run(), log = new MonitorLog();
  record.metadata.outputRepair = { round: 1, status: "running", cause: "schema", afterReport: 2, throughReport: 2 };
  assert.match(monitorBody(current, [record]).join("\n"), /исправление формата · раунд 1/);
  assert.match(log.update(current, [record]).join("\n"), /только submit_result/);
  assert.deepEqual(log.update(current, [record]), []);
  record.metadata.outputRepair = { round: 2, status: "running", cause: "missing", afterReport: 3, throughReport: 3 };
  assert.match(log.update(current, [record]).join("\n"), /раунд 2/);
  assert.equal(record.attempt, 1);
});

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

test("token details preserve unknown accounting, a reported zero and a known partial subtotal", () => {
  const missing = { ...reviewer("missing"), status: "failed" as const, metadata: { model: { provider: "fixture", id: "unknown" } } };
  const pending = reviewer("pending");
  const zero = { ...reviewer("zero"), status: "succeeded" as const, metadata: { model: { provider: "fixture", id: "zero" }, usage: { input: 0, output: 0, totalTokens: 0 }, usageComplete: true } };
  const partial = { ...reviewer("partial"), status: "failed" as const, metadata: { model: { provider: "fixture", id: "partial" }, usage: { input: 6, output: 4, totalTokens: 10 }, usageComplete: false } };
  for (const record of [missing, pending]) {
    const lines = monitorBody(run(), [record], { view: "tokens" });
    assert.equal(lines[1], "Вход: н/д · Выход: н/д");
    assert.doesNotMatch(lines.join("\n"), /н\/д ток\. · 0%/);
  }
  for (const records of [[], [zero]]) assert.equal(monitorBody(run(), records, { view: "tokens" })[1], "Вход: 0 · Выход: 0");
  assert.equal(monitorBody(run(), [partial], { view: "tokens" })[1], "Вход: 6 · Выход: 4 · известная часть");
  const mixed = monitorBody(run(), [missing, partial, zero], { view: "tokens" }).join("\n");
  assert.doesNotMatch(mixed, /н\/д ток\. · 0%/);
  assert.match(mixed, /н\/д ток\. · fixture\/unknown/);
  assert.match(mixed, /0 ток\. · 0% · fixture\/zero/);
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

test("token views sum independent workers once, preserve provider total and expose unknown usage", async () => {
  const { summarizeUsage, activationUsage, tokenSummary } = await import("../src/usage.js");
  const a = reviewer("correctness"), b = reviewer("tests", 1), pending = reviewer("docs");
  a.status = "succeeded"; a.finishedAt = 1000; a.metadata.usage = { input: 10, output: 5, totalTokens: 100, cost: 0.01 };
  b.status = "succeeded"; b.finishedAt = 2000; b.metadata.usage = { input: 20, output: 10, totalTokens: 200 };
  const parent = activation("candidate", "worktree", base); parent.metadata.usage = a.metadata.usage;
  const records = [a, b, pending, parent];
  const sum = summarizeUsage(records);
  assert.equal(sum.totalTokens, 300); // not input + output, and never count parent copies
  assert.equal(sum.input, 30); assert.equal(sum.output, 15);
  assert.equal(sum.reported, 2); assert.equal(sum.pending, 1); assert.equal(sum.partial, true);
  assert.equal(activationUsage(parent), undefined);
  assert.match(tokenSummary(records), /Токены: 300 · неполные данные · отчётов: 2\/3/);
  assert.match(renderDashboard(run(), records), /Токены: 300/);
  const detail = monitorBody(run(), records, { view: "tokens" }).join("\n");
  assert.match(detail, /Ещё работают без отчёта: 1/);
  assert.match(detail, /200 ток.*tests.*проход 2/);
  assert.match(detail, /не списание по подписке/);
  assert.match(monitorBody(run(), records, { view: "history" }).join("\n"), /✓ 200 ток\./);
  assert.match(monitorBody(run(), records, { view: "graph" }).join("\n"), /Токены: 300 · неполные данные/);
});

test("missing, invalid, zero and previous-attempt usage are not confused", async () => {
  const { summarizeUsage, tokenSummary } = await import("../src/usage.js");
  const a = reviewer("tests"); a.status = "failed";
  assert.match(tokenSummary([a]), /нет отчётов/);
  assert.equal(summarizeUsage([a]).missing, 1);
  a.metadata.usage = { input: 0, output: 0, totalTokens: 0 };
  assert.equal(summarizeUsage([a]).partial, false);
  assert.match(tokenSummary([a]), /Токены: 0 · отчётов: 1\/1/);
  a.attempt = 2;
  assert.equal(summarizeUsage([a]).partial, true);
  assert.equal(summarizeUsage([a]).earlierAttempts, 1);
  a.metadata.usage = { input: -1, output: 0, totalTokens: 0 };
  assert.equal(summarizeUsage([a]).reported, 0);
  assert.equal(summarizeUsage([]).totalTokens, 0);
});


test("monitor uses typed causes instead of stacks and labels effect certainty only on the failing activation", () => {
  const failure = {version:1 as const,code:"process" as const,phase:"setup" as const,effects:"not-started" as const,message:"Command missing"};
  const record = {...reviewer("tests"),status:"failed" as const,error:"STACK_TRACE_NOT_FOR_HEADER",metadata:{failure},finishedAt:100};
  const failed = {...run(),status:"failed" as const,error:"STACK_TRACE_NOT_FOR_HEADER",failure:{...failure,effects:"unknown" as const}};
  const text = renderDashboard(failed,[record],{height:24,width:140,now:100});
  assert.match(text,/process\/setup: Command missing/);assert.match(text,/not-started/);assert.doesNotMatch(text,/STACK_TRACE_NOT_FOR_HEADER/);
  const log = new MonitorLog();assert.match(log.update(failed,[record]).join("\n"),/process\/setup/);assert.deepEqual(log.update(failed,[record]),[]);
});
