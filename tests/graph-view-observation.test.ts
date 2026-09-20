import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { graphSnapshot } from "../src/graph-view/model.js";
import { summarizeUsage } from "../src/usage.js";
import type { ActivationRecord, RunRecord, WaitRecord } from "../src/run-store.js";
// @ts-expect-error browser module
import { layoutGraph } from "../src/graph-view/layout.js";
// @ts-expect-error browser module
import * as pages from "../src/graph-view/usage-pages.js";
// @ts-expect-error browser module
import * as taskScope from "../src/graph-view/task-scope.js";

const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
const run: RunRecord = { id: "run-observation", status: "waiting", desired: "running", cwd: "/fixture", input: null,
  ownerToken: null, supervisorPid: null, heartbeatAt: null, createdAt: 1, updatedAt: 2,
  plan: { version: 1, runtimeVersion: "dynamicwf-runtime-v2", compilerVersion: "dynamicwf-effect-v2", source: "", sourceHash: "", hash: "", agents: {},
    workflow: { schemaVersion: 1, id: "fixture", name: "Observation", revision: 1, entryGraph: "main", graphs: {
      main: { entry: "answer", nodes: [{ id: "answer", kind: "await", reason: { op: "literal", value: "Нужны данные" }, input: { op: "literal", value: {} }, responseSchema: schema }], edges: [] },
    } } },
};
const activation = (branch: string): ActivationRecord => ({ runId: run.id, key: `key-${branch}`, kind: "await", status: "running", sideEffect: false,
  ownerToken: "fixture", attempt: 1, startedAt: 1, finishedAt: null, context: { graphId: "main", nodeId: "answer", visit: 0,
    scope: ["graph", "main", "node", "council", "visit", "0", "parallel", branch, "graph", "main"] }, metadata: { waiting: true } });
const waiting = (branch: string): WaitRecord => ({ id: `wait-${branch}`, runId: run.id, key: activation(branch).key, reason: "Нужны данные",
  input: { same: "input" }, responseSchema: schema, status: "open", createdAt: 1, resolvedAt: null, resolvedBy: null });
const snapshot = (changes: Partial<RunRecord> = {}, waits: WaitRecord[] = [waiting("correctness")]) =>
  graphSnapshot({ ...run, ...changes }, waits.map(wait => activation(wait.id.slice(5))), new Map(), waits);

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  className = "";
  value = "";
  ownText = "";
  listeners = new Map<string, ((event: Event) => unknown)[]>();
  constructor(public tagName = "div") {}
  set textContent(value: string) { this.ownText = String(value); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set innerHTML(_value: string) { throw new Error("HTML insertion forbidden"); }
  insertAdjacentHTML() { throw new Error("HTML insertion forbidden"); }
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.ownText = ""; this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = String(value); if (key === "class") this.className = String(value); }
  getAttribute(key: string) { return key === "class" ? this.className : this.attributes[key]; }
  addEventListener(name: string, fn: (event: Event) => unknown) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  dispatchEvent(event: Event) { for (const fn of this.listeners.get(event.type) ?? []) fn(event); return !event.defaultPrevented; }
  getBoundingClientRect() { return { width: 900, height: 600 }; }
}
const source = readFileSync(new URL("../src/graph-view/app.js", import.meta.url), "utf8");
const boundary = "await refreshRuns();\nlet tick = 0;";
assert.equal(source.split(boundary).length, 2);
// Stop only automatic network startup. Run production UI functions and handlers unchanged.
const app = source.split(boundary)[0]!.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "");
async function replay(script: string, fixtures: Record<string, unknown> = {}) {
  const elements = new Map<string, Element>();
  const document = { body: new Element("body"), activeElement: null,
    getElementById(id: string) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; },
    createElement: (tag: string) => new Element(tag), createElementNS: (_ns: string, tag: string) => new Element(tag), querySelectorAll: () => [],
  };
  await runInNewContext(app + `\n(async () => {
    const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
    const buttons = () => descendants($('content-panel')).filter(node => node.tagName === 'button');
    const fields = () => descendants($('content-panel')).filter(node => node.tagName === 'textarea');
    state.id = base.id; state.run = base; state.graph = base.entryGraph; state.tab = 'now';
    ${script}
  })()`, { ...pages, ...taskScope, layoutGraph, document, Event, assert, base: snapshot(), ...fixtures,
    window: { addEventListener() {} }, ResizeObserver: class { observe() {} }, fetch() { throw new Error("Unexpected request"); } });
}

test("same-run snapshots cannot restore an older wait/status or replace a current connection message", async () => {
  await replay(`
    const pending = [];
    globalThis.fetch = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    const oldRead = refreshSnapshot(), currentRead = refreshSnapshot();
    pending[1].resolve({ ok: true, status: 200, json: async () => current }); await currentRead;
    pending[0].resolve({ ok: true, status: 200, json: async () => base }); await oldRead;
    assert.equal(state.run.status, 'paused');
    assert.equal(state.run.waits[0].status, 'resolved');
    assert.equal(fields().length, 0);
    assert.equal($('run-status').textContent, 'Пауза');
    const staleError = refreshSnapshot(), latestRead = refreshSnapshot();
    pending[3].resolve({ ok: true, status: 200, json: async () => current }); await latestRead;
    pending[2].reject(new Error('STALE_NETWORK_ERROR')); await staleError;
    assert.equal($('connection').textContent, '● Данные обновляются');
    assert.doesNotMatch($('notice').textContent, /STALE_NETWORK_ERROR/);
    assert.equal(state.run.status, 'paused');
  `, { current: snapshot({ status: "paused", desired: "paused", updatedAt: 3 }, [{ ...waiting("correctness"), status: "resolved", response: { answer: "known" }, resolvedAt: 3 }]) });
});

test("switching away and back still rejects the previous visit's snapshot", async () => {
  await replay(`
    const pending = [];
    globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
    const oldVisit = refreshSnapshot();
    const away = selectRun(other.id, 'none');
    pending[1]({ ok: true, status: 200, json: async () => other }); await away;
    const back = selectRun(base.id, 'none');
    pending[2]({ ok: true, status: 200, json: async () => current }); await back;
    pending[0]({ ok: true, status: 200, json: async () => base }); await oldVisit;
    assert.equal(state.run.id, base.id);
    assert.equal(state.run.status, 'paused');
  `, { other: snapshot({ id: "run-other", status: "succeeded" }, []), current: snapshot({ status: "paused", desired: "paused" }, []) });
});

test("an old selection callback cannot clear the new visit's whole-task view", async () => {
  await replay(`
    const pending = [];
    globalThis.fetch = path => {
      if (path.startsWith('snapshot?')) return new Promise(resolve => pending.push(resolve));
      return new Promise(() => {}); // Leave independent background task totals pending.
    };
    state.id = 'initial'; state.run = { ...base, id: 'initial', lineage: { taskId: 'other-task' } };
    state.runs = [first, second];
    const oldVisit = selectRun(first.id, 'none');
    const away = selectRun(second.id, 'none');
    pending[1]({ ok: true, status: 200, json: async () => second }); await away;
    state.usageScope = 'task'; state.taskUsage = { taskId: 'shared-task' }; state.linkedRuns = [second];
    const back = selectRun(first.id, 'none');
    pending[2]({ ok: true, status: 200, json: async () => first }); await back;
    assert.equal(state.usageScope, 'task');
    pending[0]({ ok: true, status: 200, json: async () => first }); await oldVisit;
    assert.equal(state.usageScope, 'task');
    assert.equal(state.taskUsage.taskId, 'shared-task');
    assert.equal(state.linkedRuns[0].id, second.id);
  `, { first: { ...snapshot({ id: "first" }, []), lineage: { taskId: "shared-task" } },
    second: { ...snapshot({ id: "second" }, []), lineage: { taskId: "shared-task" } } });
});

test("superseded authentication and body decoding cannot reload or overwrite the current snapshot", async () => {
  await replay(`
    const pending = []; let reloads = 0;
    window.location = { reload() { reloads++; } };
    globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
    const staleSession = refreshSnapshot(), latest = refreshSnapshot();
    pending[1]({ ok: true, status: 200, json: async () => base }); await latest;
    fields()[0].value = 'saved draft'; fields()[0].dispatchEvent(new Event('input'));
    pending[0]({ ok: false, status: 401 }); await staleSession;
    assert.equal(reloads, 0); assert.equal(fields()[0].value, 'saved draft');
    assert.equal($('connection').textContent, '● Данные обновляются');
    let decode;
    const decoding = refreshSnapshot();
    pending[2]({ ok: true, status: 200, json: () => new Promise(resolve => { decode = resolve; }) });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(typeof decode, 'function');
    const newer = refreshSnapshot();
    pending[3]({ ok: true, status: 200, json: async () => current }); await newer;
    decode(base); await decoding;
    assert.equal(state.run.status, 'paused');
    const currentSession = refreshSnapshot();
    pending[4]({ ok: false, status: 401 }); await currentSession;
    assert.equal(reloads, 1, 'the current session still refreshes after viewer restart');
  `, { current: snapshot({ status: "paused", desired: "paused" }, []) });
});

test("await and resume controls reflect cancellation and source replacement without changing pause semantics", async () => {
  const cases = [
    { value: snapshot(), accepts: true, resumes: false },
    { value: snapshot({ status: "paused", desired: "paused" }), accepts: true, resumes: true },
    { value: snapshot({ status: "interrupted" }), accepts: true, resumes: true },
    { value: snapshot({ status: "cancelling", desired: "cancelled" }), accepts: false, resumes: false },
    { value: snapshot({ status: "interrupted", desired: "cancelled" }), accepts: false, resumes: false },
    ...(["succeeded", "failed", "cancelled"] as const).map(status => ({ value: snapshot({ status }), accepts: false, resumes: false })),
    { value: snapshot({ status: "interrupted", lineage: { taskId: "task-fixture", role: "root", parentRunId: null, successorRunId: "run-successor", launchedWithTask: true } }), accepts: false, resumes: false },
    { value: snapshot({ status: "paused", desired: "paused", lineage: { taskId: "task-fixture", role: "root", parentRunId: null, successorRunId: "run-successor", launchedWithTask: true } }), accepts: false, resumes: false },
  ];
  await replay(`
    for (const item of cases) {
      state.run = item.value; renderHeader(); renderPanel();
      assert.equal(fields().length > 0, item.accepts, item.value.status);
      assert.equal(buttons().some(button => button.textContent === 'Сохранить ответ' && !button.disabled), item.accepts);
      assert.equal(!$('resume').hidden, item.resumes);
      if (!item.accepts) assert.equal($('wait-summary').hidden, true);
      if (item.value.lineage?.successorRunId) {
        assert.match($('content-panel').textContent, /продолжени/);
        assert.doesNotMatch($('content-panel').textContent, /Ожидание следующего шага/);
      }
      if (item.accepts && item.value.desired === 'paused') assert.match($('content-panel').textContent, /после снятия паузы/);
    }
  `, { cases });
});

test("a retained answer handler cannot send after its wait becomes unavailable", async () => {
  await replay(`
    renderPanel();
    fields()[0].value = '{"answer":"known"}'; fields()[0].dispatchEvent(new Event('input'));
    const submit = buttons().find(button => button.textContent === 'Сохранить ответ').listeners.get('click')[0];
    let posts = 0; globalThis.fetch = () => { posts++; throw new Error('Unexpected mutation'); };
    for (const value of unavailable) { state.run = value; await submit(new Event('click')); }
    state.run = null; await submit(new Event('click'));
    state.run = base; state.id = 'other-run'; await submit(new Event('click'));
    assert.equal(posts, 0);
    assert.equal(waitDrafts.get(base.waits[0].id).text, '{"answer":"known"}');
  `, { unavailable: [snapshot({ status: "cancelling", desired: "cancelled" }),
    snapshot({ lineage: { taskId: "task-fixture", role: "root", parentRunId: null, successorRunId: "run-successor", launchedWithTask: true } }),
    snapshot({}, [{ ...waiting("correctness"), status: "resolved" }])] });
});

test("identical wait questions retain visible scope/ID and independent drafts across reordered snapshots", async () => {
  const waits = [waiting("correctness"), waiting("security")];
  waits[0]!.reason = '<img src=x onerror="boom"> Нужны данные';
  waits[1]!.reason = waits[0]!.reason;
  await replay(`
    state.run = multiple; renderHeader(); renderPanel();
    let cards = $('content-panel').children.filter(node => node.className === 'wait-card');
    assert.notEqual(cards[0].textContent, cards[1].textContent);
    assert.match(cards[0].textContent, /wait-correctness/);
    assert.ok(cards[0].textContent.includes('council #1 / correctness / answer · проход 1'));
    assert.match(cards[1].textContent, /wait-security/);
    assert.ok(cards[1].textContent.includes('council #1 / security / answer · проход 1'));
    assert.ok(!descendants($('content-panel')).some(node => node.tagName === 'img'));
    assert.notEqual(fields()[0].getAttribute('aria-label'), fields()[1].getAttribute('aria-label'));
    for (const field of fields()) assert.ok(field.getAttribute('aria-label').includes(field.dataset.waitId));
    for (const [index, field] of fields().entries()) { field.value = 'draft-' + field.dataset.waitId; field.dispatchEvent(new Event('input')); }
    state.run = { ...multiple, waits: [...multiple.waits].reverse() }; renderPanel();
    for (const field of fields()) assert.equal(field.value, 'draft-' + field.dataset.waitId);
    state.tab = 'history'; renderPanel(); state.tab = 'now'; renderPanel();
    for (const field of fields()) assert.equal(field.value, 'draft-' + field.dataset.waitId);
  `, { multiple: snapshot({}, waits) });
});

test("run navigation distinguishes missing accounting, known zero and a partial subtotal", async () => {
  const agent: ActivationRecord = { ...activation("agent"), kind: "agent", status: "failed", metadata: {} };
  const known: ActivationRecord = { ...agent, metadata: { usage: { input: 0, output: 0, totalTokens: 0 }, usageComplete: true } };
  const partial: ActivationRecord = { ...agent, metadata: { usage: { input: 6, output: 4, totalTokens: 10 }, usageComplete: false } };
  const summaries = [
    { id: "run-missing", summary: summarizeUsage([agent]) },
    { id: "run-pending", summary: summarizeUsage([{ ...agent, status: "running" }]) },
    { id: "run-zero", summary: summarizeUsage([known]) },
    { id: "run-partial", summary: summarizeUsage([partial]) },
    { id: "run-empty", summary: summarizeUsage([]) },
  ];
  await replay(`
    state.run = { ...base, lineage: { taskId: 'task-fixture' } }; state.tab = 'tokens'; state.usageScope = 'task';
    state.taskUsage = { taskId: 'task-fixture', summary: summaries[0].summary, runs: summaries, reusedOutputs: 0 };
    state.linkedRuns = []; renderTokens();
    const label = id => buttons().find(button => button.textContent.startsWith(id)).textContent;
    for (const id of ['run-missing', 'run-pending']) { assert.match(label(id), /Нет отчётов/); assert.doesNotMatch(label(id), /0 ток/); }
    for (const id of ['run-zero', 'run-empty']) assert.equal(label(id), id + ' · 0 ток.');
    assert.match(label('run-partial'), /10 ток.*[Ии]звестная часть/);
    state.runs = summaries.map(item => ({ ...base, id: item.id, usage: item.summary })); renderRuns();
    const runLabels = $('runs').children.map(item => item.children.find(child => child.className === 'mini-id').textContent);
    for (const text of runLabels.slice(0, 2)) { assert.match(text, /Нет отчётов/); assert.doesNotMatch(text, /0 ток/); }
    for (const index of [2, 4]) assert.match(runLabels[index], /· 0 ток\\.$/);
    assert.match(runLabels[3], /10 ток.*[Ии]звестная часть/);
  `, { summaries });
});
