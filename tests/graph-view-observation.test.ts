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
// @ts-expect-error browser module
import * as navigation from "../src/graph-view/navigation.js";
// @ts-expect-error browser module
import * as executionData from "../src/graph-view/execution-data.js";
// @ts-expect-error browser module
import * as viewState from "../src/graph-view/view-state.js";
// @ts-expect-error browser module
import * as workspace from "../src/graph-view/workspace.js";
// @ts-expect-error browser module
import { createExecutionDetails } from "../src/graph-view/execution-details.js";

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
  id = "";
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  className = "";
  value = "";
  ownText = "";
  open = false;
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection = "none";
  scrollTop = 0;
  scrollLeft = 0;
  listeners = new Map<string, ((event: Event) => unknown)[]>();
  constructor(public tagName = "div") {}
  set textContent(value: string) { this.ownText = String(value); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set innerHTML(_value: string) { throw new Error("HTML insertion forbidden"); }
  insertAdjacentHTML() { throw new Error("HTML insertion forbidden"); }
  append(...nodes: Element[]) { this.children.push(...nodes); }
  prepend(...nodes: Element[]) { this.children.unshift(...nodes); }
  replaceChildren(...nodes: Element[]) { this.ownText = ""; this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = String(value); if (key === "class") this.className = String(value); }
  getAttribute(key: string) { return key === "class" ? this.className : this.attributes[key]; }
  addEventListener(name: string, fn: (event: Event) => unknown) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  dispatchEvent(event: Event) { for (const fn of this.listeners.get(event.type) ?? []) fn(event); return !event.defaultPrevented; }
  click() { this.dispatchEvent(new Event('click')); }
  getBoundingClientRect() { return { width: 900, height: 600 }; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus(_options?: unknown) {}
  setSelectionRange(start: number, end: number, direction = "none") {
    this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
  }
}
const source = readFileSync(new URL("../src/graph-view/app.js", import.meta.url), "utf8");
const boundary = "await refreshRuns();\nlet tick = 0;";
assert.equal(source.split(boundary).length, 2);
// Stop only automatic network startup. Run production UI functions and handlers unchanged.
const app = source.split(boundary)[0]!.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "");
async function replay(script: string, fixtures: Record<string, unknown> = {}) {
  const elements = new Map<string, Element>();
  const browserEvents = new Map<string, () => void>();
  const descendants = (node: Element): Element[] => node.children.flatMap(child => [child, ...descendants(child)]);
  const document = { body: new Element("body"), activeElement: null as Element | null,
    getElementById(id: string) {
      const found = [...elements.values()].flatMap(descendants).find(node => node.id === id);
      if (found) return found;
      if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!;
    },
    createElement(tag: string) { const node = new Element(tag); node.focus = () => { document.activeElement = node; }; return node; },
    createElementNS: (_ns: string, tag: string) => new Element(tag),
    querySelectorAll(selector: string) {
      return selector === "details[data-wait-details]"
        ? [...elements.values()].flatMap(descendants).filter(node => node.tagName === "details" && node.dataset.waitDetails) : [];
    },
  };
  await runInNewContext(app + `\n(async () => {
    const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
    const buttons = () => descendants($('content-panel')).filter(node => node.tagName === 'button');
    const fields = () => descendants($('content-panel')).filter(node => node.tagName === 'textarea');
    state.id = base.id; state.run = base; state.graph = base.entryGraph; state.tab = 'now';
    ${script}
  })()`, { ...pages, ...taskScope, ...navigation, ...executionData, ...viewState, ...workspace, createExecutionDetails, layoutGraph, document, Event, assert, browserEvents, base: snapshot(), ...fixtures,
    window: { addEventListener(name: string, handler: () => void) { browserEvents.set(name, handler); } }, ResizeObserver: class { observe() {} }, fetch() { throw new Error("Unexpected request"); } });
}

test("wait disclosures stay attached to their IDs through updates, reordering and navigation", async () => {
  await replay(`
    const details = () => Array.from(descendants($('content-panel')).filter(node => node.tagName === 'details'));
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>state.run});
    renderPanel(); details()[0].open=true;
    state.run={...state.run,usage:{...state.run.usage,totalTokens:5}};
    await refreshSnapshot();
    assert.deepEqual(details().map(node=>node.open),[true,false]);
    state.run={...state.run,waits:[...state.run.waits].reverse()}; renderPanel();
    assert.deepEqual(details().map(node=>node.open),[false,true]);
    details()[1].open=false; renderPanel();
    assert.deepEqual(details().map(node=>node.open),[false,false]);
    details()[0].open=true; setTab('history'); setTab('now');
    assert.deepEqual(details().map(node=>node.open),[true,false]);
    const original=state.run; state.id=other.id; state.run=other; renderPanel();
    assert.deepEqual(details().map(node=>node.open),[false]);
    state.id=original.id; state.run=original; renderPanel();
    assert.deepEqual(details().map(node=>node.open),[true,false]);
    state.run={...state.run,waits:[...state.run.waits,newWait]}; renderPanel();
    assert.deepEqual(details().map(node=>node.open),[true,false,false]);
  `, { base: snapshot({}, [waiting("correctness"), waiting("security")]),
    other: snapshot({ id: "run-other" }, [{ ...waiting("other"), runId: "run-other" }]), newWait: waiting("new") });
});

test("snapshot updates keep wait draft focus, directional selection and scroll position", async () => {
  await replay(`
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({...base,usage:{...base.usage,totalTokens:5}})});
    renderPanel(); const field=fields()[0];
    field.value='line1\\nline2\\nline3'; field.dispatchEvent(new Event('input')); field.focus();
    field.setSelectionRange(3,12,'backward'); field.scrollTop=70; field.scrollLeft=25;
    await refreshSnapshot();
    const updated=fields()[0];
    assert.notEqual(updated,field); assert.equal(document.activeElement,updated);
    assert.equal(updated.value,'line1\\nline2\\nline3');
    assert.deepEqual([updated.selectionStart,updated.selectionEnd,updated.selectionDirection],[3,12,'backward']);
    assert.deepEqual([updated.scrollTop,updated.scrollLeft],[70,25]);
  `);
});

test("late 401 from background task, trace, usage and inspection reads cannot reload a new visit", async () => {
  for (const kind of ["task", "trace", "tokens", "attempts", "recovery", "reconciliations"]) for (const returnToSource of [false, true]) await replay(`
    let finish, reloads = 0; const requests = [];
    const prefix = {task:'task-usage?',trace:'trace?',tokens:'usage?',attempts:'attempts?',recovery:'recovery?',reconciliations:'reconciliations?'}[kind];
    window.location = {reload(){reloads++;}};
    globalThis.fetch = path => {
      requests.push(path);
      if (path.startsWith(prefix)) return new Promise(resolve => {finish=resolve;});
      if (path.startsWith('reconciliations?')) return Promise.resolve({ok:true,status:200,json:async()=>[]});
      if (path.startsWith('snapshot?')) return Promise.resolve({ok:true,status:200,json:async()=>path.endsWith(other.id)?other:base});
      throw Error('Unexpected request: '+path);
    };
    let work;
    if (kind === 'task') {
      state.tab='tokens'; renderTokens();
      work=buttons().find(b=>b.textContent==='Вся задача').listeners.get('click')[0](new Event('click'));
    } else if (kind === 'trace') {
      state.run.trace={supported:true,count:1,failed:0,lastSeq:1}; state.tab='trace'; renderTrace();
    } else if (kind === 'tokens') {
      state.tab='tokens'; renderTokens();
      work=buttons().find(b=>b.textContent==='Показать исходные отчёты ответов').listeners.get('click')[0](new Event('click'));
    } else {
      const box=el('div'), activation={key:'key-operation',attempt:1,status:'failed'};
      if (kind==='attempts') renderAttempts(box,activation);
      else if (kind==='recovery') renderRecovery(box,activation);
      else renderReconciliations(box,activation);
      const label={attempts:'Попытки: 1',recovery:'Проверить состояние для восстановления',reconciliations:'Решения о восстановлении'}[kind];
      work=descendants(box).find(b=>b.tagName==='button'&&b.textContent===label).listeners.get('click')[0](new Event('click'));
    }
    state.tab='now'; await selectRun(other.id,'none'); if (returnToSource) await selectRun(base.id,'none');
    fields()[0].value='CURRENT_DRAFT'; fields()[0].dispatchEvent(new Event('input')); notice('CURRENT_NOTICE');
    const before=requests.length;
    finish({ok:false,status:401}); await work;
    for(let i=0;i<12;i++) await Promise.resolve(); // Drain the trace renderer's automatic page load.
    assert.equal(reloads,0,kind);
    assert.equal(requests.length,before);
    assert.equal(fields()[0].value,'CURRENT_DRAFT');
    assert.equal($('notice').textContent,'CURRENT_NOTICE');
  `, { kind, returnToSource, base: { ...snapshot(), lineage: { taskId: "task-a" } },
    other: { ...snapshot({ id: "run-other" }, [{ ...waiting("other"), runId: "run-other" }]), lineage: { taskId: "task-b" } } });
});

test("background usage responses and decoding errors still settle into their original cache after navigation", async () => {
  for (const mode of ["success", "decoding", "failure", "invalid-json", "401"]) await replay(`
    let finish, finishBody, rejectBody, bodyStarted, reloads=0;
    const requests=[], bodyReady=new Promise(resolve=>{bodyStarted=resolve;});
    window.location={reload(){reloads++;}};
    globalThis.fetch=path=>{
      requests.push(path);
      if(path.startsWith('usage?'))return new Promise(resolve=>{finish=resolve;});
      return Promise.resolve({ok:true,status:200,json:async()=>path.endsWith(other.id)?other:base});
    };
    state.tab='tokens';renderTokens();
    const loading=buttons().find(b=>b.textContent==='Показать исходные отчёты ответов').listeners.get('click')[0](new Event('click'));
    if(mode==='decoding'||mode==='failure'||mode==='invalid-json'){
      finish({ok:mode!=='failure',status:mode==='failure'?400:200,json:()=>new Promise((resolve,reject)=>{finishBody=resolve;rejectBody=reject;bodyStarted();})});await bodyReady;
    }
    state.tab='now';await selectRun(other.id,'none');
    fields()[0].value='OTHER_DRAFT';fields()[0].dispatchEvent(new Event('input'));notice('OTHER_NOTICE');
    const page={reports:[{seq:7,key:'key-correctness',attempt:1,reportId:'original',usage:{input:1,output:2,totalTokens:3},stopReason:'stop'}],nextAfter:7,hasMore:false};
    if(mode==='401')finish({ok:false,status:401});
    else if(mode==='failure')finishBody({error:'ORIGINAL_HTTP_BODY_ERROR'});
    else if(mode==='invalid-json')rejectBody(new SyntaxError('ORIGINAL_INVALID_JSON'));
    else if(mode==='decoding')finishBody(page);
    else finish({ok:true,status:200,json:async()=>page});
    await loading;
    const cached=usagePages.get(base.id);
    assert.equal(cached.loading,false);assert.equal(reloads,0);
    if(mode==='success'||mode==='decoding'){
      assert.equal(JSON.stringify(cached.reports),JSON.stringify(page.reports));assert.equal(cached.cursor,7);assert.equal(cached.error,null);
    }else{
      assert.equal(cached.reports.length,0);assert.equal(cached.cursor,0);
      assert.match(cached.error,mode==='401'?/Сессия панели изменилась/:mode==='invalid-json'?/ORIGINAL_INVALID_JSON/:/ORIGINAL_HTTP_BODY_ERROR/);
      assert.doesNotMatch(cached.error,/Восстанавливаем подключение/);
    }
    assert.equal(usagePages.get(other.id).reports.length,0);
    assert.equal(fields()[0].value,'OTHER_DRAFT');assert.equal($('notice').textContent,'OTHER_NOTICE');
    assert.equal(requests.filter(path=>path.startsWith('usage?')).length,1);
    await selectRun(base.id,'none');state.tab='tokens';renderTokens();
    if(cached.error){
      assert.ok($('content-panel').textContent.includes(cached.error));
      assert.doesNotMatch($('content-panel').textContent,/Восстанавливаем подключение/);
    }
  `, { mode, other: snapshot({ id: "run-other" }, [{ ...waiting("other"), runId: "run-other" }]) });
});

test("late recovery receipts remain usable without changing another visit or repeating the decision", async () => {
  for (const mode of ["success", "decoding", "401", "failure"]) for (const returnToSource of [false, true]) await replay(`
    let finish,fail,finishBody,bodyStarted,reloads=0;
    const requests=[],bodyReady=new Promise(resolve=>{bodyStarted=resolve;});
    window.location={reload(){reloads++;}};
    globalThis.fetch=(path,options)=>{
      requests.push({path,body:options?.body});
      if(path==='reconcile')return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
      if(path.startsWith('snapshot?'))return Promise.resolve({ok:true,status:200,json:async()=>path.endsWith(other.id)?other:base});
      throw Error('Unexpected request: '+path);
    };
    const box=el('div'),activation={key:'key-operation',attempt:1,status:'failed'};
    const inspection={value:{attempt:1,checkpoint:'checkpoint',workspace:{digest:'workspace'}},records:[]};
    renderRecoveryForm(box,activation,inspection,async()=>{});
    const identity=JSON.stringify([base.id,activation.key,1]),draft=recoveryDrafts.get(identity);
    Object.assign(draft,{action:'retry',actor:'Fixture reviewer',reason:'Verified fixture',evidence:'No outside effects'});
    const sending=descendants(box).find(b=>b.tagName==='button'&&b.textContent==='Сохранить решение').listeners.get('click')[0](new Event('click'));
    if(mode==='decoding'){
      finish({ok:true,status:200,json:()=>new Promise(resolve=>{finishBody=resolve;bodyStarted();})});await bodyReady;
    }
    await selectRun(other.id,'none');if(returnToSource)await selectRun(base.id,'none');
    fields()[0].value='CURRENT_DRAFT';fields()[0].dispatchEvent(new Event('input'));notice('CURRENT_NOTICE');
    const before=requests.length,request=JSON.parse(requests.find(r=>r.path==='reconcile').body),receipt={request,createdAt:3};
    if(mode==='401')finish({ok:false,status:401});
    else if(mode==='failure')fail(Error('ORIGINAL_RECONCILE_FAILURE'));
    else if(mode==='decoding')finishBody(receipt);
    else finish({ok:true,status:200,json:async()=>receipt});
    await sending;
    assert.equal(reloads,0);assert.equal(requests.length,before);
    assert.equal(fields()[0].value,'CURRENT_DRAFT');assert.equal($('notice').textContent,'CURRENT_NOTICE');
    assert.equal(requests.filter(r=>r.path==='reconcile').length,1);
    assert.equal(draft.request.decisionId,request.decisionId);assert.equal(draft.busy,false);
    if(mode==='success'||mode==='decoding'){
      assert.deepEqual(draft.receipt,receipt);
      assert.equal(JSON.stringify(reconciliationRecords.get(JSON.stringify([base.id,activation.key])).value),JSON.stringify([receipt]));
    }else{
      assert.equal(draft.receipt,null);
      assert.match(draft.error,mode==='401'?/Сессия панели изменилась/:/ORIGINAL_RECONCILE_FAILURE/);
    }
  `, { mode, returnToSource, crypto: { randomUUID: () => "fixture-decision-id" }, base: snapshot({ status: "paused", desired: "paused" }),
    other: snapshot({ id: "run-other" }, [{ ...waiting("other"), runId: "run-other" }]) });
});

test("current recovery replies still refresh the run and current 401 still reloads", async () => {
  for(const unauthorized of [false,true])await replay(`
    let reloads=0;const requests=[];window.location={reload(){reloads++;}};
    globalThis.fetch=async(path,options)=>{
      requests.push({path,body:options?.body});
      if(path==='reconcile')return unauthorized?{ok:false,status:401}:{ok:true,status:200,json:async()=>({request:JSON.parse(options.body),createdAt:3})};
      return {ok:true,status:200,json:async()=>base};
    };
    const box=el('div'),activation={key:'key-operation',attempt:1,status:'failed'};
    renderRecoveryForm(box,activation,{value:{attempt:1,checkpoint:'checkpoint',workspace:{digest:'workspace'}},records:[]},async()=>{});
    const draft=recoveryDrafts.get(JSON.stringify([base.id,activation.key,1]));
    Object.assign(draft,{action:'retry',actor:'Fixture reviewer',reason:'Verified fixture',evidence:'No outside effects'});
    await descendants(box).find(b=>b.tagName==='button'&&b.textContent==='Сохранить решение').listeners.get('click')[0](new Event('click'));
    assert.equal(reloads,unauthorized?1:0);
    assert.equal(requests.filter(r=>r.path==='reconcile').length,1);
    assert.equal(requests.filter(r=>r.path.startsWith('snapshot?')).length,unauthorized?0:1);
    assert.equal(draft.busy,false);assert.equal(draft.request.decisionId,'fixture-decision-id');
    if(unauthorized)assert.match(draft.error,/Восстанавливаем подключение/);else assert.equal(draft.receipt.request.decisionId,'fixture-decision-id');
  `,{unauthorized,crypto:{randomUUID:()=>"fixture-decision-id"},base:snapshot({status:"paused",desired:"paused"})});
});


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

test("a delayed wait response cannot reload another visit or trigger its snapshot request", async () => {
  for (const mode of ["success", "decoding", "401", "failure"]) for (const returnToSource of [false, true]) await replay(`
    let finish, fail, decode, bodyStarted, reloads = 0;
    const requests = [], decoding = new Promise(resolve => { bodyStarted = resolve; });
    window.location = { reload() { reloads++; } };
    globalThis.fetch = (path, options) => {
      requests.push({ path, body: options?.body });
      if (path === 'resolve') return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      return Promise.resolve({ok:true,status:200,json:async()=>path.endsWith(other.id) ? other : base});
    };
    renderPanel(); fields()[0].value = '{"answer":"original"}'; fields()[0].dispatchEvent(new Event('input'));
    const sending = buttons().find(button => button.textContent === 'Сохранить ответ').listeners.get('click')[0](new Event('click'));
    if (mode === 'decoding') {
      finish({ok:true,status:200,json:()=>new Promise(resolve=>{decode=resolve;bodyStarted();})});
      await decoding;
    }
    await selectRun(other.id, 'none');
    if (returnToSource) await selectRun(base.id, 'none');
    fields()[0].value = 'CURRENT_DRAFT'; fields()[0].dispatchEvent(new Event('input'));
    notice('CURRENT_MESSAGE'); const beforeReply = requests.length;
    if (mode === 'failure') fail(new Error('ANSWER_NETWORK_FAILURE'));
    else if (mode === '401') finish({ok:false,status:401});
    else if (mode === 'decoding') decode({});
    else finish({ok:true,status:200,json:async()=>({})});
    await sending;
    assert.equal(state.id, returnToSource ? base.id : other.id);
    assert.equal(reloads, 0);
    assert.equal(requests.length, beforeReply, 'old submission must not start a read for the current visit');
    assert.equal(fields()[0].value, 'CURRENT_DRAFT');
    assert.equal($('notice').textContent, 'CURRENT_MESSAGE');
    const posts = requests.filter(request => request.path === 'resolve');
    assert.equal(posts.length, 1); assert.equal(JSON.parse(posts[0].body).id, base.id);
    assert.equal(JSON.parse(posts[0].body).response.answer, 'original');
    assert.equal(waitDrafts.get(base.waits[0].id).busy, false);
  `, { mode, returnToSource, other: snapshot({id:'run-other'}, [{...waiting('other'),runId:'run-other'}]) });
});

test("a current wait response still refreshes its state and a current 401 still reconnects", async () => {
  for (const mode of ["success", "401", "failure"]) await replay(`
    let reloads = 0; const requests = [];
    window.location = {reload(){reloads++;}};
    globalThis.fetch = async (path, options) => {
      requests.push({path,body:options?.body});
      if (path === 'resolve') {
        if (mode === '401') return {ok:false,status:401};
        if (mode === 'failure') throw Error('CURRENT_ANSWER_FAILURE');
        return {ok:true,status:200,json:async()=>({})};
      }
      return {ok:true,status:200,json:async()=>resolved};
    };
    renderPanel(); fields()[0].value = '{"answer":"current"}'; fields()[0].dispatchEvent(new Event('input'));
    await buttons().find(button=>button.textContent==='Сохранить ответ').listeners.get('click')[0](new Event('click'));
    assert.equal(reloads, mode === '401' ? 1 : 0);
    assert.equal(requests.length, mode === 'success' ? 2 : 1);
    if (mode === 'success') { assert.equal(fields().length,0); assert.equal(state.run.waits[0].status,'resolved'); }
    else {
      assert.equal(fields()[0].value,'{"answer":"current"}');
      assert.match($('content-panel').textContent,mode==='401' ? /Восстанавливаем подключение/ : /CURRENT_ANSWER_FAILURE/);
    }
    assert.equal(waitDrafts.get(base.waits[0].id).busy,false);
  `, { mode, resolved: snapshot({}, [{...waiting('correctness'),status:'resolved',response:{answer:'current'},resolvedAt:3}]) });
});

test("changing runs closes cancellation and an old confirmation cannot cancel the newly selected run", async () => {
  await replay(`
    const mutations = [];
    globalThis.fetch = async (path, options) => {
      if (path === 'control') { mutations.push(JSON.parse(options.body)); return {ok:true,status:200,json:async()=>({})}; }
      if (path === 'runs') return {ok:true,status:200,json:async()=>({runs:[base,other]})};
      return {ok:true,status:200,json:async()=>path.endsWith(other.id) ? other : base};
    };
    $('cancel').dispatchEvent(new Event('click'));
    assert.equal($('cancel-dialog').open, true);
    assert.ok($('cancel-target').textContent.includes(base.id));
    await selectRun(other.id, 'none');
    assert.equal($('cancel-dialog').open, false);
    $('cancel-confirm').dispatchEvent(new Event('click'));
    assert.equal(mutations.length, 0);
    await selectRun(base.id, 'none');
    $('cancel-confirm').dispatchEvent(new Event('click'));
    assert.equal(mutations.length, 0);
    $('cancel').dispatchEvent(new Event('click'));
    $('cancel-confirm').dispatchEvent(new Event('click'));
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].id, base.id);
    assert.equal(mutations[0].command, 'cancel');
  `, { other: snapshot({id:'run-other'}, []) });
});

test("a delayed control reply or failure cannot replace the next run's feedback", async () => {
  for (const failure of [false, true]) await replay(`
    let finishControl, rejectControl, reloads = 0;
    const mutations = [];
    window.location = {reload(){ reloads++; }};
    globalThis.fetch = (path, options) => {
      if (path === 'control') {
        mutations.push(JSON.parse(options.body));
        return new Promise((resolve,reject)=>{finishControl=resolve;rejectControl=reject;});
      }
      if (path === 'runs') return Promise.resolve({ok:true,status:200,json:async()=>({runs:[base,other]})});
      return Promise.resolve({ok:true,status:200,json:async()=>other});
    };
    const pendingControl = control('pause');
    await selectRun(other.id,'none');
    state.controlError = 'CURRENT_RUN_MESSAGE'; notice(state.controlError);
    if (failure) rejectControl(new Error('PREVIOUS_RUN_FAILURE'));
    else finishControl({ok:false,status:401});
    await pendingControl;
    assert.equal(state.id, other.id);
    assert.equal(state.controlError, 'CURRENT_RUN_MESSAGE');
    assert.equal($('notice').textContent, 'CURRENT_RUN_MESSAGE');
    assert.equal(reloads, 0);
    assert.equal(state.busy, false);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].id, base.id);
  `, { other: snapshot({id:'run-other'}, []), failure });
});

test("a control follow-up list cannot update another run after a delayed result, failure or 401", async () => {
  for (const mode of ["success", "decoding", "failure", "401"]) await replay(`
    let finishList, rejectList, finishBody, startedList, reloads = 0;
    const listStarted = new Promise(resolve => { startedList = resolve; });
    const mutations = [];
    window.location = {reload(){ reloads++; }};
    globalThis.fetch = (path, options) => {
      if (path === 'control') {
        mutations.push(JSON.parse(options.body));
        return Promise.resolve({ok:true,status:200,json:async()=>({})});
      }
      if (path === 'runs') {
        startedList();
        return new Promise((resolve,reject)=>{finishList=resolve;rejectList=reject;});
      }
      return Promise.resolve({ok:true,status:200,json:async()=>path.endsWith(other.id) ? other : base});
    };
    const command = control('pause'); await listStarted;
    if (mode === 'decoding') {
      finishList({ok:true,status:200,json:()=>new Promise(resolve=>{finishBody=resolve;})});
      await Promise.resolve(); await Promise.resolve();
      assert.equal(typeof finishBody,'function');
    }
    await selectRun(other.id,'none');
    state.runs = [other]; state.listSignature = 'CURRENT_RUN_LIST';
    state.controlError = 'CURRENT_RUN_MESSAGE'; notice(state.controlError);
    if (mode === 'failure') rejectList(new Error('PREVIOUS_CONTROL_LIST_FAILURE'));
    else if (mode === '401') finishList({ok:false,status:401});
    else if (mode === 'decoding') finishBody({runs:[base]});
    else finishList({ok:true,status:200,json:async()=>({runs:[base]})});
    await command;
    assert.equal(state.id,other.id,mode);
    assert.equal(state.runs.length,1,mode); assert.equal(state.runs[0].id,other.id,mode);
    assert.equal(state.listSignature,'CURRENT_RUN_LIST',mode);
    assert.equal(state.controlError,'CURRENT_RUN_MESSAGE',mode);
    assert.equal($('notice').textContent,'CURRENT_RUN_MESSAGE',mode);
    assert.equal($('connection').textContent,'● Данные обновляются',mode);
    assert.equal(reloads,0,mode); assert.equal(state.busy,false,mode);
    assert.equal(mutations.length,1,mode); assert.equal(mutations[0].id,base.id,mode);
  `, { other: snapshot({id:'run-other'}, []), mode });
});

test("a control follow-up list stays stale after returning to the same run during JSON decoding", async () => {
  await replay(`
    let finishBody, startedBody;
    const bodyStarted = new Promise(resolve=>{startedBody=resolve;});
    const mutations = [];
    globalThis.fetch = (path,options) => {
      if (path === 'control') {
        mutations.push(JSON.parse(options.body));
        return Promise.resolve({ok:true,status:200,json:async()=>({})});
      }
      if (path === 'runs') return Promise.resolve({ok:true,status:200,json:()=>new Promise(resolve=>{finishBody=resolve;startedBody();})});
      return Promise.resolve({ok:true,status:200,json:async()=>path.endsWith(other.id) ? other : base});
    };
    const command = control('pause'); await bodyStarted;
    await selectRun(other.id,'none'); await selectRun(base.id,'none');
    state.runs = [base]; state.listSignature = 'LATEST_VISIT_LIST';
    state.controlError = 'LATEST_VISIT_MESSAGE'; notice(state.controlError);
    finishBody({runs:[other]}); await command;
    assert.equal(state.id,base.id);
    assert.equal(state.runs.length,1); assert.equal(state.runs[0].id,base.id);
    assert.equal(state.listSignature,'LATEST_VISIT_LIST');
    assert.equal($('notice').textContent,'LATEST_VISIT_MESSAGE');
    assert.equal(mutations.length,1); assert.equal(mutations[0].id,base.id);
  `, { other: snapshot({id:'run-other'}, []) });
});

test("an unscoped list refresh still updates the list and handles a current 401", async () => {
  await replay(`
    let reloads = 0;
    window.location = {reload(){reloads++;}};
    globalThis.fetch = async () => ({ok:true,status:200,json:async()=>({runs:[other]})});
    await refreshRuns();
    assert.equal(state.runs.length,1); assert.equal(state.runs[0].id,other.id);
    assert.equal(state.id,base.id);
    globalThis.fetch = async () => ({ok:false,status:401});
    await refreshRuns();
    assert.equal(reloads,1);
    assert.match($('notice').textContent,/Восстанавливаем подключение/);
  `, { other: snapshot({id:'run-other'}, []) });
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
    const runLabels = descendants($('runs')).filter(item => item.className === 'mini-id').map(item => item.textContent);
    for (const text of runLabels.slice(0, 2)) { assert.match(text, /Нет отчётов/); assert.doesNotMatch(text, /0 ток/); }
    for (const index of [2, 4]) assert.match(runLabels[index], /· 0 ток\\.$/);
    assert.match(runLabels[3], /10 ток.*[Ии]звестная часть/);
  `, { summaries });
});

test("newer run lists own their success, errors and authorization feedback", async () => {
  for (const mode of ["success", "failure", "401", "decode"]) await replay(`
    let finish, fail, decode, reloads=0;
    window.location={reload(){reloads++}};
    globalThis.fetch=()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
    const old=refreshRuns();
    if(mode==='decode'){finish({ok:true,status:200,json:()=>new Promise(resolve=>{decode=resolve})});await Promise.resolve();}
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({runs:[{...base,status:'paused'}]})});
    await refreshRuns(); notice('new-feedback');
    if(mode==='failure')fail(Error('old-error'));
    else if(mode==='401')finish({ok:false,status:401});
    else if(mode==='decode')decode({runs:[base]});
    else finish({ok:true,status:200,json:async()=>({runs:[base]})});
    await old;
    assert.equal(state.runs[0].status,'paused');assert.equal(reloads,0);assert.equal($('notice').textContent,'new-feedback');
  `,{mode});
});

test("equivalent slow task loads coalesce, settle and can subsequently refresh", async () => {
  await replay(`
    state.usageScope='task';let finish,calls=0,total=30;
    globalThis.fetch=path=>{
      if(path.startsWith('task-usage?')){calls++;return new Promise(resolve=>{finish=()=>resolve({ok:true,status:200,json:async()=>({taskId:'task-a',summary:{totalTokens:total},runs:[]})});});}
      if(path.startsWith('task?'))return Promise.resolve({ok:true,status:200,json:async()=>({members:[]})});
      throw Error(path);
    };
    renderTokens();assert.match($('content-panel').textContent,/Загружаем расход всей задачи/);
    const first=loadTaskScope('task-a');
    assert.equal(loadTaskScope('task-a'),first);assert.equal(loadTaskScope('task-a'),first);assert.equal(calls,1);
    finish();assert.equal(await first,true);assert.equal(state.taskUsage.summary.totalTokens,30);
    total=45;const next=loadTaskScope('task-a');assert.equal(calls,2);finish();await next;
    assert.equal(state.taskUsage.summary.totalTokens,45);
  `,{base:{...snapshot(),lineage:{taskId:'task-a'}}});
});

test("recovery receipt fences earlier history and inspection reads", async () => {
  for (const kind of ['history','inspection']) for (const failed of [false,true]) await replay(`
    const activation={key:'key-operation',attempt:1,status:'failed'}, identity=JSON.stringify([base.id,activation.key]);
    const inspection={value:{attempt:1,checkpoint:'checkpoint',workspace:{digest:'workspace',roots:[],entries:0,bytes:0},blockers:[]},records:[]};
    recoveryInspections.set(identity,inspection);
    let finish,fail,receipt;
    globalThis.fetch=path=>{
      if(path.startsWith('reconciliations?'))return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
      if(path.startsWith('recovery?'))return Promise.resolve({ok:true,status:200,json:async()=>inspection.value});
      if(path==='reconcile')return Promise.resolve({ok:true,status:200,json:async()=>receipt});
      if(path.startsWith('snapshot?'))return Promise.resolve({ok:true,status:200,json:async()=>base});
      throw Error(path);
    };
    const history=el('div');
    if(kind==='history')renderReconciliations(history,activation);else renderRecovery(history,activation);
    const reading=descendants(history).find(n=>n.tagName==='button').listeners.get('click')[0](new Event('click'));
    const form=el('div');renderRecoveryForm(form,activation,inspection,async()=>{});
    const draft=recoveryDrafts.get(JSON.stringify([base.id,activation.key,1]));
    Object.assign(draft,{action:'retry',actor:'reviewer',reason:'fixture',evidence:'fixture evidence'});
    receipt={request:{decisionId:'decision',action:'retry'},createdAt:3};
    await descendants(form).find(n=>n.tagName==='button'&&n.textContent==='Сохранить решение').listeners.get('click')[0](new Event('click'));
    if(failed)fail(Error('old-error'));else finish({ok:true,status:200,json:async()=>[]});
    await reading;
    assert.equal(reconciliationRecords.get(identity).value[0].request.decisionId,'decision');
    assert.equal(reconciliationRecords.get(identity).saved,true);
    assert.equal(recoveryInspections.get(identity).records[0].request.decisionId,'decision');
    assert.equal(recoveryInspections.get(identity).loading,false);
    // Свежий GET может уточнить статус: сохранённая квитанция не замораживает кэш.
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>[{...receipt,application:{attempt:2}}]});
    const newer=el('div');renderReconciliations(newer,activation);
    await descendants(newer).find(n=>n.tagName==='button').listeners.get('click')[0](new Event('click'));
    assert.equal(reconciliationRecords.get(identity).value[0].application.attempt,2);
  `,{kind,failed,crypto:{randomUUID:()=> 'decision'},base:snapshot({status:'paused',desired:'paused'})});
});

test("wait actions keep focus while a neighbouring activation updates", async () => {
  for (const tag of ['summary','button']) await replay(`
    renderPanel();const control=descendants($('content-panel')).find(n=>n.tagName===tag&&n.dataset.waitControl);
    control.focus();renderPanel();
    const updated=descendants($('content-panel')).find(n=>n.id===control.id);
    assert.notEqual(updated,control);assert.equal(document.activeElement,updated);
  `,{tag});
});

test("resolved waits stay visible as saved while paused without asking again", async () => {
  const a=activation('correctness');a.metadata.waitId='wait-correctness';
  const w={...waiting('correctness'),status:'resolved' as const,response:{answer:'ready'},resolvedAt:3,resolvedBy:'fixture'};
  const base=graphSnapshot({...run,status:'paused',desired:'paused'},[a],new Map(),[w]);
  assert.equal(base.graphs[0]!.nodes[0]!.status,'answered');
  assert.deepEqual(base.presentation.waitingKeys,[]);
  await replay(`renderPanel();assert.match($('content-panel').textContent,/Ответ сохранён · на паузе/);assert.match($('content-panel').textContent,/ready/);assert.equal(fields().length,0);`,{base});
});

test("late inspection failure preserves newer decision history",async()=>{
await replay(`
 const activation={key:'key-operation',attempt:1,status:'failed'}, identity=JSON.stringify([base.id,activation.key]);
 const inspection={value:{attempt:1,checkpoint:'checkpoint',workspace:{digest:'workspace',roots:[],entries:0,bytes:0},blockers:[]},records:[]};
 recoveryInspections.set(identity,inspection);
 let failInspection;
 globalThis.fetch=path=>{
   if(path.startsWith('recovery?'))return new Promise((_,reject)=>{failInspection=reject;});
   if(path.startsWith('reconciliations?'))return Promise.resolve({ok:true,status:200,json:async()=>[]});
   throw Error(path);
 };
 const panel=el('div');renderRecovery(panel,activation);
 const reading=descendants(panel).find(n=>n.tagName==='button').listeners.get('click')[0](new Event('click'));
 const latest={request:{decisionId:'fresh',action:'retry'},createdAt:3};
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>[latest]});
 const history=el('div');renderReconciliations(history,activation);
 await descendants(history).find(n=>n.tagName==='button').listeners.get('click')[0](new Event('click'));
 assert.equal(recoveryInspections.get(identity).records[0].request.decisionId,'fresh');
 failInspection(Error('OLD_INSPECTION_FAILED'));await reading;
 assert.equal(recoveryInspections.get(identity).records[0]?.request.decisionId,'fresh');
`,{base:snapshot({status:'paused',desired:'paused'})});
});

test("stale inspection history cannot reload after a newer history read",async()=>{
await replay(`
 const activation={key:'key-operation',attempt:1,status:'failed'}, identity=JSON.stringify([base.id,activation.key]);
 const inspection={value:{attempt:1,checkpoint:'checkpoint',workspace:{digest:'workspace',roots:[],entries:0,bytes:0},blockers:[]},records:[]};
 recoveryInspections.set(identity,inspection);
 let finishHistory,reloads=0;
 window.location={reload(){reloads++}};
 globalThis.fetch=path=>{
   if(path.startsWith('recovery?'))return Promise.resolve({ok:true,status:200,json:async()=>inspection.value});
   if(path.startsWith('reconciliations?'))return new Promise(resolve=>{finishHistory=resolve;});
   throw Error(path);
 };
 const panel=el('div');renderRecovery(panel,activation);
 const reading=descendants(panel).find(n=>n.tagName==='button').listeners.get('click')[0](new Event('click'));
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>[{request:{decisionId:'fresh',action:'retry'}}]});
 const history=el('div');renderReconciliations(history,activation);
 await descendants(history).find(n=>n.tagName==='button').listeners.get('click')[0](new Event('click'));
 finishHistory({ok:false,status:401});await reading;
 assert.equal(reloads,0);
`,{base:snapshot({status:'paused',desired:'paused'})});
});

test("same-run Back/Forward and reload restore exact execution, branch, attempt and view", async () => {
  await replay(`
    const first={...base.graphs[0].nodes[0].activations[0],visit:1,attempt:3};
    const second={...first,key:'second-key',visit:2,attempt:1,scope:'["other-branch"]'};
    state.run={...base,graphs:[{...base.graphs[0],nodes:[{...base.graphs[0].nodes[0],activations:[first,second]}]}]};
    const node=state.run.graphs[0].nodes[0];
    const urls=[];window.location={href:'http://127.0.0.1/?run='+base.id};
    window.history={pushState(_s,_t,url){window.location.href=String(url);urls.push(String(url));},replaceState(_s,_t,url){window.location.href=String(url);}};
    await openActivation({...first,node,graphId:'main'}); setTab('history'); const previous=window.location.href;
    await openActivation({...second,node,graphId:'main'}); const next=window.location.href;
    assert.equal(state.key,'second-key');assert.equal(state.attempt,1);
    window.location.href=previous;browserEvents.get('popstate')();
    assert.equal(state.key,first.key);assert.equal(state.attempt,3);assert.equal(state.scope,first.scope);assert.equal(state.tab,'history');
    assert.equal($('inspector').hidden,false);assert.match($('selection-context').textContent,/проход 1.*попытка 3/);
    window.location.href=next;browserEvents.get('popstate')();
    assert.equal(state.key,second.key);assert.equal(state.scope,second.scope);
    state.key=null;state.attempt=null;state.graph=null;state.scope='';state.node=null;
    Object.assign(state,resolveLocation(state.run,readLocation(next)));renderPanel();
    assert.equal(state.key,second.key);assert.equal(state.attempt,1);assert.equal(state.tab,'history');
    assert.match($('selection-context').textContent,/проход 2.*попытка 1/);
  `, { URL });
});

test("inspector disclosure, scroll and selection stay with the exact execution through journal updates", async () => {
  await replay(`
    state.node='answer';state.key=base.graphs[0].nodes[0].activations[0].key;state.attempt=1;state.scope=base.graphs[0].nodes[0].activations[0].scope;
    renderPanel();
    const disclosures=()=>descendants($('inspector')).filter(n=>n.tagName==='details');
    disclosures()[0].open=true;$('inspector').scrollTop=170;
    state.run={...state.run,usage:{...state.run.usage,totalTokens:99}};renderPanel();
    assert.equal(disclosures()[0].open,true);assert.equal($('inspector').scrollTop,170);
    const selected=state.key;navigate({graph:'main',node:'answer'});
    assert.equal(disclosures()[0].open,false,'definition selection has its own disclosure state');
    navigate({graph:'main',node:'answer',key:selected,attempt:1});
    assert.equal(disclosures()[0].open,true);assert.equal($('inspector').scrollTop,170);
  `);
});


test("attempt selector navigates to archived identity and never substitutes the latest result", async () => {
  await replay(`
    const a=state.run.graphs[0].nodes[0].activations[0];a.attempt=2;
    const identity=JSON.stringify([state.id,a.key]);
    const current={attempt:2,status:'succeeded',startedAt:2,finishedAt:3,metadata:{},output:{value:'LATEST'}};
    const archived={attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{},error:'ARCHIVED FAILURE'};
    Object.assign(attemptPages.get(identity),{opened:true,reports:[archived]});
    attemptPages.snapshots.set(identity,{current,missingArchived:0});
    state.node='answer';state.key=a.key;state.attempt=2;state.scope=a.scope;
    window.location={href:'http://127.0.0.1/?run='+state.id};
    window.history={pushState(_s,_t,url){window.location.href=String(url);}};
    renderPanel();
    const select=descendants($('inspector')).find(n=>n.tagName==='button'&&n.textContent==='Выбрать попытку 1');
    select.dispatchEvent(new Event('click'));
    assert.equal(state.attempt,1);assert.equal(new URL(window.location.href).searchParams.get('attempt'),'1');
    assert.match($('inspector').textContent,/ARCHIVED FAILURE/);assert.doesNotMatch($('inspector').textContent,/LATEST/);
    renderPanel();assert.equal(state.attempt,1);assert.match($('inspector').textContent,/ARCHIVED FAILURE/);
  `, { URL });
});

test("archive selection keeps latest rows unselected and labels the graph as latest", async () => {
  await replay(`
    const item = state.run.graphs[0].nodes[0].activations[0];
    item.attempt = 2; item.status = 'succeeded'; item.result = 'LATEST_RESULT';
    state.run.status='succeeded'; state.run.activeKeys=[];
    state.tab='history'; state.key=item.key; state.attempt=1; state.node=item.nodeId;
    renderPanel();
    const rows=descendants($('content-panel')).filter(n=>n.className==='task-row');
    assert.equal(rows.length,1); assert.equal(rows[0].getAttribute('data-selected'),'false');
    assert.match(rows[0].textContent,/последняя попытка 2 · выбрана архивная попытка 1/);
    state.tab='graph'; renderPanel();
    assert.match($('graph-context').textContent,/последнее состояние узлов, не результат архивной попытки/);
    const activity=descendants($('activity-strip')).find(n=>n.className==='task-row');
    assert.equal(activity.getAttribute('data-selected'),'false');
    assert.match(activity.textContent,/LATEST_RESULT/);
    assert.match(descendants($('graph')).find(n=>n.getAttribute('role')==='button').getAttribute('aria-label'),/последнее состояние узла/);
  `);
});

test("missing graph stays missing through render and polling, without borrowing another graph's node", async () => {
  await replay(`
    window.location={href:'http://localhost/?run='+base.id+'&graph=missing&node=answer'};
    window.history={pushState(){},replaceState(){}};
    Object.assign(state,resolveLocation(state.run,readLocation(window.location.href)));
    renderPanel();
    assert.equal(state.graph,'missing'); assert.match(state.missing,/граф отсутствует/);
    assert.equal($('graph').children.length,0); assert.equal($('graph-select').value,'missing');
    assert.doesNotMatch($('inspector').textContent,/Нужны данные|ВЫПОЛНЕНИЯ ЭТОГО УЗЛА/);
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>base});
    await refreshSnapshot();
    assert.equal(state.graph,'missing'); assert.match(state.missing,/граф отсутствует/);
    assert.equal($('graph').children.length,0);
    assert.equal(new URL(window.location.href).searchParams.get('graph'),'missing');
  `, { URL });
});

test("second Back during a delayed same-run load wins, including the archived attempt", async () => {
  await replay(`
    const key=base.graphs[0].nodes[0].activations[0].key;
    const scope=base.graphs[0].nodes[0].activations[0].scope;
    const routes = [
      {id:base.id,graph:'main',node:'answer',key,attempt:1,scope,tab:'graph'},
      {id:base.id,graph:'main',node:'answer',key,attempt:2,scope,tab:'history'},
    ];
    window.location={href:locationFor('http://localhost/',routes[1]).href};
    window.history={pushState(){},replaceState(){}};
    let release;
    globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});
    state.id='run-other'; state.run={...base,id:'run-other'};
    browserEvents.get('popstate')(); // Back from B to A/attempt 2, snapshot not yet available.
    assert.equal(state.run,null);
    window.location.href=locationFor('http://localhost/',routes[0]).href;
    browserEvents.get('popstate')(); // Back again to A/attempt 1 while still loading.
    release({ok:true,status:200,json:async()=>({...base,graphs:base.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,activations:n.activations.map(a=>({...a,attempt:2}))}))}))})});
    for(let i=0;i<12;i++) await Promise.resolve();
    assert.deepEqual([state.id,state.graph,state.node,state.key,state.attempt,state.tab],
      [base.id,'main','answer',key,1,'graph']);
    assert.match($('inspector').textContent,/архивная попытка/);
    assert.equal(locationFor(window.location.href,state).href,window.location.href);
  `, { URL });
});

test("stale cross-run activation cannot overwrite a newer A → B → A choice", async () => {
  await replay(`
    const a={...base,id:'A'}, b={...base,id:'B'};
    const pending=[]; globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
    state.id='start';state.run={...base,id:'start'};
    const target={runId:'A',graphId:'main',nodeId:'answer',scope:'',key:base.graphs[0].nodes[0].activations[0].key};
    const old=openActivation({...target,attempt:1});
    const away=selectRun('B','none');
    pending[1]({ok:true,status:200,json:async()=>b});await away;
    const latest=openActivation({...target,attempt:2});
    pending[2]({ok:true,status:200,json:async()=>a});await latest;
    pending[0]({ok:true,status:200,json:async()=>a});await old;
    assert.deepEqual([state.id,state.key,state.attempt],['A',target.key,2]);
  `);
});

test("inspector child link opens only the selected parent's exact branch and visit", async () => {
  await replay(`
    const main=state.run.graphs[0], parent=main.nodes[0];
    parent.kind='parallel'; parent.children=[{id:'correctness',graphId:'child'},{id:'security',graphId:'child'}];
    const first={...parent.activations[0],key:'parent-1',visit:1,scope:'["graph","main"]',attempt:1};
    const second={...first,key:'parent-2',visit:2}; parent.activations=[first,second];
    const scope=(v,branch)=>JSON.stringify(['graph','main','node','answer','visit',String(v),'parallel',branch,'graph','child']);
    const child={...parent,id:'review',kind:'agent',children:[],activations:[
      {...first,key:'review-first',scope:scope(0,'correctness')},
      {...first,key:'review-other',scope:scope(0,'security')},
      {...second,key:'review-second',scope:scope(1,'correctness')} ]};
    state.run.graphs.push({id:'child',entry:'review',nodes:[child],edges:[]});
    state.key='parent-2';state.attempt=1;state.node='answer';state.graph='main';
    renderPanel();
    const links=descendants($('inspector')).filter(n=>n.tagName==='button');
    const exact=links.filter(n=>n.textContent.includes('этот проход'));
    assert.ok(exact.length >= 1);assert.ok(exact.every(n=>n.textContent.includes('correctness')));
    exact[0].dispatchEvent(new Event('click'));
    assert.equal(state.graph,'child');assert.equal(state.scope,scope(1,'correctness'));
    assert.equal(selectedGraph().nodes[0].activations.length,1);
    assert.equal(selectedGraph().nodes[0].activations[0].key,'review-second');
    assert.match($('breadcrumbs').textContent,/answer/);
  `);
});

test("delayed trace page redraw restores focused open condition details", async () => {
  await replay(`
    state.tab='trace';state.run.trace={supported:true,count:2,failed:0,lastSeq:2};
    const record={seq:1,key:'key-correctness',attempt:1,at:1,context:{graphId:'main',scope:[],visit:0},
      decision:{from:'answer',to:'answer',reason:'condition',evaluations:[{edgeIndex:0,to:'answer',result:'true'}]}};
    Object.assign(tracePages.get(state.id),{opened:true,reports:[record],cursor:1,hasMore:true});
    renderPanel();
    const details=descendants($('content-panel')).find(n=>n.tagName==='details');
    details.open=true;const summary=details.children[0];summary.focus();
    let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
    const loading=descendants($('content-panel')).find(n=>n.tagName==='button'&&n.textContent==='Загрузить следующие переходы').listeners.get('click')[0](new Event('click'));
    finish({ok:true,status:200,json:async()=>({records:[{...record,seq:2}],nextAfter:2,hasMore:false})});
    await loading;
    const updated=descendants($('content-panel')).find(n=>n.tagName==='details');
    assert.equal(updated.open,true);assert.equal(document.activeElement,updated.children[0]);
  `);
});

test("delayed usage page redraw keeps the focused scope control", async () => {
  await replay(`
    state.tab='tokens';state.run.lineage={taskId:'task-a'};
    renderPanel();
    const scope=buttons().find(n=>n.textContent==='Этот запуск');scope.focus();
    let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
    const loading=buttons().find(n=>n.textContent==='Показать исходные отчёты ответов').listeners.get('click')[0](new Event('click'));
    finish({ok:true,status:200,json:async()=>({reports:[],nextAfter:0,hasMore:false})});
    await loading;
    assert.equal(document.activeElement,buttons().find(n=>n.textContent==='Этот запуск'));
  `);
});

test("pending activation click does not undo a newer Back route within its loading run", async () => {
  await replay(`
    const key=base.graphs[0].nodes[0].activations[0].key;
    window.location={href:'http://localhost/?run=B'};
    window.history={pushState(_s,_t,url){window.location.href=String(url)},replaceState(){}};
    state.id='B';state.run={...base,id:'B'};
    let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve});
    const old=openActivation({runId:base.id,graphId:'main',nodeId:'answer',key,attempt:1});
    window.location.href=locationFor('http://localhost/',{id:base.id,graph:'main',node:'answer',key,attempt:2,tab:'graph'}).href;
    browserEvents.get('popstate')();
    finish({ok:true,status:200,json:async()=>({...base,graphs:base.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,activations:n.activations.map(a=>({...a,attempt:2}))}))}))})});
    await old;
    assert.deepEqual([state.id,state.key,state.attempt],[base.id,key,2]);
  `,{URL});
});

test("automatic trace tail after a snapshot preserves condition disclosure, focus and scroll", async () => {
  await replay(`
    state.tab='trace'; state.run.trace={supported:true,count:1,failed:0,lastSeq:1};
    const record={seq:1,key:'key-correctness',attempt:1,at:1,context:{graphId:'main',scope:[],visit:0},
      decision:{from:'answer',to:'answer',reason:'condition',evaluations:[{edgeIndex:0,to:'answer',result:'true'}]}};
    const page=tracePages.get(state.id);
    Object.assign(page,{opened:true,reports:[record],cursor:1,hasMore:false});
    renderPanel();
    const condition=descendants($('content-panel')).find(n=>n.tagName==='details');
    condition.open=true; condition.children[0].focus(); $('content-panel').scrollTop=45;
    let finish;
    globalThis.fetch=path=>path.startsWith('snapshot?')
      ? Promise.resolve({ok:true,status:200,json:async()=>({...base,trace:{...state.run.trace,count:2,lastSeq:2}})})
      : new Promise(resolve=>{finish=resolve});
    await refreshSnapshot();
    let current=descendants($('content-panel')).find(n=>n.tagName==='details');
    assert.equal(page.loading,true);
    assert.equal(current.open,true); assert.equal(document.activeElement,current.children[0]);
    assert.equal($('content-panel').scrollTop,45);
    finish({ok:true,status:200,json:async()=>({records:[{...record,seq:2}],nextAfter:2,hasMore:false})});
    for(let i=0;i<20;i++)await Promise.resolve();
    current=descendants($('content-panel')).find(n=>n.tagName==='details');
    assert.equal(page.loading,false);assert.equal(page.reports.length,2);
    assert.equal(current.open,true);assert.equal(document.activeElement,current.children[0]);
    assert.equal($('content-panel').scrollTop,45);
  `);
});

test("breadcrumb focus remains on its exact parent across an unrelated snapshot update", async () => {
  await replay(`
    const parent=state.run.graphs[0].nodes[0];parent.kind='subworkflow';parent.children=[{id:'nested',graphId:'child'}];
    const a=parent.activations[0];a.visit=1;a.scope='["graph","main"]';
    const childScope=JSON.stringify(['graph','main','node','answer','visit','0','graph','child']);
    state.run.graphs.push({id:'child',entry:'answer',nodes:[{...parent,children:[],activations:[{...a,key:'child-key',scope:childScope}]}],edges:[]});
    state.graph='child';state.scope=childScope;renderPanel();
    const links=()=>descendants($('breadcrumbs')).filter(n=>n.tagName==='button');
    assert.equal(links().length,3);const original=links()[1];original.focus();
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({...state.run,usage:{...state.run.usage,totalTokens:17}})});
    await refreshSnapshot();
    assert.notEqual(links()[1],original);assert.equal(document.activeElement,links()[1]);
    assert.equal(links()[1].dataset.uiKey,original.dataset.uiKey);
  `);
});

test("an archived structural attempt cannot claim latest child links in the outline", async () => {
  await replay(`
    const parent=state.run.graphs[0].nodes[0];parent.kind='parallel';parent.children=[{id:'correctness',graphId:'child'}];
    const a=parent.activations[0];a.key='parent';a.visit=1;a.attempt=2;a.scope='["graph","main"]';
    const scope=JSON.stringify(['graph','main','node','answer','visit','0','parallel','correctness','graph','child']);
    state.run.graphs.push({id:'child',entry:'review',nodes:[{...parent,id:'review',children:[],activations:[{...a,key:'child-latest',scope}]}],edges:[]});
    state.node='answer';state.graph='main';state.key='parent';state.attempt=1;renderPanel();
    const outline=descendants($('outline'));
    assert.match($('outline').textContent,/попытка 1 · архив/);
    assert.match($('outline').textContent,/Архивная попытка: связь с дочерними вызовами не записана/);
    assert.equal(outline.filter(n=>n.className.includes('child-link')).length,0);
    assert.ok(outline.some(n=>n.tagName==='button'&&n.textContent.includes('все вызовы (без выбора выполнения)')));
    assert.doesNotMatch($('inspector').textContent,/Открыть correctness · этот проход/);
    state.attempt=2;renderPanel();
    assert.equal(descendants($('outline')).filter(n=>n.className.includes('child-link')).length,1);
  `);
});

test("selected latest attempt labels cumulative activation usage separately from its own attempt", async () => {
  await replay(`
    const node=state.run.graphs[0].nodes[0],a=node.activations[0];
    node.kind='agent';a.attempt=2;a.usage={input:12,output:8,totalTokens:20};
    state.key=a.key;state.node=node.id;state.scope=a.scope;state.attempt=2;
    const identity=JSON.stringify([state.id,a.key]);
    Object.assign(attemptPages.get(identity),{opened:true,reports:[{attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{},kind:'agent',accounting:{usage:{totalTokens:8},responses:1,complete:true}}]});
    attemptPages.snapshots.set(identity,{current:{attempt:2,status:'succeeded',startedAt:2,finishedAt:3,metadata:{},kind:'agent',accounting:{usage:{totalTokens:12},responses:1,complete:true}},missingArchived:0});
    renderPanel();
    const text=$('inspector').textContent;
    assert.ok(text.includes('Расход выполнения за все попытки (накопленный): 20 ток'));
    assert.match(text,/Расход ниже относится к каждой попытке отдельно/);
    assert.match(text,/Попытка 2 · последняя.*12 ток/);
  `);
});

test("dropdowns clear missing graph and scope notices immediately on unchanged snapshots", async () => {
  await replay(`
    state.graph='missing';state.node='answer';state.missing='Выбранный граф отсутствует в плане.';
    renderPanel();assert.match($('selection-context').textContent,/граф отсутствует/);
    $('graph-select').value='main';$('graph-select').dispatchEvent(new Event('change'));
    assert.equal(state.graph,'main');assert.equal(state.missing,null);
    assert.doesNotMatch($('selection-context').textContent,/отсутствует/);
    assert.equal($('inspector').hidden,true);
    state.scope='["missing"]';Object.assign(state,resolveLocation(state.run,state));renderPanel();
    assert.match(state.missing,/область выполнения отсутствует/);
    $('scope-select').value='';$('scope-select').dispatchEvent(new Event('change'));
    assert.equal(state.scope,'');assert.equal(state.missing,null);
    assert.doesNotMatch($('selection-context').textContent,/отсутствует/);
  `);
});

test("cross-run archived execution is one history entry and Back/Forward restore both executions", async () => {
  await replay(`
    const a=base.graphs[0].nodes[0].activations[0];
    const b={...base,id:'B',graphs:base.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,activations:n.activations.map(item=>({...item,key:'B-key',attempt:2}))}))}))};
    state.node='answer';state.key=a.key;state.attempt=1;state.scope=a.scope;state.tab='history';
    const first=locationFor('http://localhost/',state).href, entries=[first];let position=0;
    window.location={href:first};
    window.history={pushState(_s,_t,url){entries.splice(++position);entries.push(String(url));window.location.href=String(url);},
      replaceState(_s,_t,url){entries[position]=String(url);window.location.href=String(url);},
      back(){if(position){window.location.href=entries[--position];browserEvents.get('popstate')();}},
      forward(){if(position<entries.length-1){window.location.href=entries[++position];browserEvents.get('popstate')();}}};
    globalThis.fetch=async path=>({ok:true,status:200,json:async()=>path.endsWith('B')?b:base});
    const attemptKey=JSON.stringify(['B','B-key']);
    Object.assign(attemptPages.get(attemptKey),{opened:true,reports:[],hasMore:false});
    renderPanel();
    await openActivation({runId:'B',graphId:'main',nodeId:'answer',scope:b.graphs[0].nodes[0].activations[0].scope,key:'B-key',attempt:1});
    assert.equal(entries.length,2,'no intermediate B-only history entry');
    assert.equal(new URL(entries[1]).searchParams.get('activation'),'B-key');
    assert.deepEqual([state.id,state.graph,state.key,state.attempt],['B','main','B-key',1]);
    window.history.back();for(let i=0;i<25;i++)await Promise.resolve();
    assert.equal(window.location.href,first);
    assert.deepEqual([state.id,state.graph,state.key,state.attempt],[base.id,'main',a.key,1]);
    window.history.forward();for(let i=0;i<25;i++)await Promise.resolve();
    assert.equal(window.location.href,entries[1]);
    assert.deepEqual([state.id,state.graph,state.key,state.attempt],['B','main','B-key',1]);
    assert.match($('inspector').textContent,/архивная попытка/,JSON.stringify({run:state.run?.id,scope:state.scope,key:state.key,activations:state.run?.graphs[0]?.nodes[0]?.activations}));
  `,{URL});
});

test("poll superseding the initial cross-run snapshot still commits the exact pending execution", async () => {
  await replay(`
    const a=base.graphs[0].nodes[0].activations[0];
    const b={...base,id:'B',graphs:base.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,activations:n.activations.map(item=>({...item,key:'B-key',attempt:2}))}))}))};
    state.tab='history';state.key=a.key;state.node='answer';state.scope=a.scope;state.attempt=1;
    const entries=[];window.location={href:locationFor('http://localhost/',state).href};
    window.history={pushState(_s,_t,url){entries.push(String(url));window.location.href=String(url);},replaceState(){}};
    const pending=[];globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
    const target={runId:'B',graphId:'main',nodeId:'answer',scope:b.graphs[0].nodes[0].activations[0].scope,key:'B-key',attempt:1};
    const opening=openActivation(target);
    assert.equal(pending.length,1);assert.equal(entries.length,0);
    const polling=refreshSnapshot();assert.equal(pending.length,2);
    pending[0]({ok:true,status:200,json:async()=>b});await opening;
    assert.equal(state.run,null);assert.equal(entries.length,0);
    pending[1]({ok:true,status:200,json:async()=>b});await polling;
    assert.deepEqual([state.id,state.graph,state.scope,state.key,state.attempt],['B','main',target.scope,'B-key',1]);
    assert.equal(entries.length,1);assert.equal(new URL(entries[0]).searchParams.get('attempt'),'1');
    assert.equal(new URL(entries[0]).searchParams.get('activation'),'B-key');
    assert.match($('inspector').textContent,/архивная попытка/);
  `,{URL});
});

test("old outline links are hidden and fenced throughout a delayed or failed run switch", async () => {
  await replay(`
    state.tab='graph';state.node='answer';
    state.run.graphs[0].nodes[0].children=[{id:'nested',graphId:'child'}];renderPanel();
    const old=descendants($('outline')).find(n=>n.tagName==='button'&&n.textContent.startsWith('Схема ·'));
    const child=descendants($('outline')).find(n=>n.tagName==='button'&&n.textContent.includes('Схема nested'));
    assert.ok(old);assert.ok(child);
    window.location={href:'http://localhost/?run='+base.id};
    const urls=[];window.history={pushState(_s,_t,url){urls.push(String(url));window.location.href=String(url);}};
    let fail;globalThis.fetch=()=>new Promise((resolve,reject)=>{fail=reject;});
    const switchRun=selectRun('B');
    assert.equal($('outline').hidden,true);assert.equal($('breadcrumbs').hidden,true);
    const next=window.location.href;
    old.dispatchEvent(new Event('click'));child.dispatchEvent(new Event('click'));
    assert.equal(window.location.href,next);assert.equal(state.graph,null);assert.equal(state.run,null);
    fail(Error('B is unavailable'));await switchRun;
    assert.equal($('outline').hidden,true);
    old.dispatchEvent(new Event('click'));child.dispatchEvent(new Event('click'));
    assert.equal(window.location.href,next);assert.equal(state.graph,null);
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({...base,id:'B'})});
    await refreshSnapshot();
    assert.equal($('outline').hidden,false);
    old.dispatchEvent(new Event('click'));child.dispatchEvent(new Event('click'));
    assert.equal(state.id,'B');assert.equal(state.node,null);assert.equal(window.location.href,next);
    assert.equal(urls.length,1);
  `);
});

test("poll superseding a cross-run selection reconciles whole-task mode only after the accepted snapshot", async () => {
  await replay(`
    const a={...base,id:'A',lineage:{taskId:'shared'}},b={...base,id:'B',lineage:{taskId:'shared'}};
    state.id='A';state.run=a;state.usageScope='task';state.runs=[a,b];
    state.taskUsage={taskId:'shared',summary:{totalTokens:7}};
    const pending=[];globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
    const opening=openActivation({runId:'B',graphId:'main',nodeId:'answer',scope:base.graphs[0].nodes[0].activations[0].scope,key:base.graphs[0].nodes[0].activations[0].key,attempt:1});
    const polling=refreshSnapshot();
    pending[0]({ok:true,status:200,json:async()=>b});await opening;
    assert.equal(state.run,null);assert.equal(state.usageScope,'task');
    pending[1]({ok:true,status:200,json:async()=>b});await polling;
    assert.equal(state.usageScope,'task');assert.equal(state.taskUsage.taskId,'shared');
  `);
});

test("late inspector reads cache results without redrawing an A → B → A visit awaiting its snapshot", async () => {
  for (const kind of ['attempts','recovery','reconciliations','retries','collection'])
    for (const mode of ['success','failure','401']) await replay(`
      const activation={key:'key-operation',attempt:1,status:'failed'},identity=JSON.stringify([base.id,activation.key]);
      const oldVisit=state.runSelection;
      const snapshots=[];let finish,fail,reloads=0;
      window.location={reload(){reloads++;}};
      const prefix={attempts:'attempts?',recovery:'recovery?',reconciliations:'reconciliations?',retries:'retries?',collection:'collections?'}[kind];
      globalThis.fetch=path=>{
        if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push({path,resolve}));
        if(path.startsWith(prefix))return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
        if(kind==='recovery'&&path.startsWith('reconciliations?'))return Promise.resolve({ok:true,status:200,json:async()=>[]});
        throw Error('Unexpected read '+path);
      };
      const box=el('div');
      if(kind==='attempts')renderAttempts(box,activation);
      else if(kind==='recovery')renderRecovery(box,activation);
      else if(kind==='reconciliations')renderReconciliations(box,activation);
      else if(kind==='retries')renderRetries(box,activation);
      else renderCollection(box,activation);
      const label={attempts:'Попытки: 1',recovery:'Проверить состояние для восстановления',
        reconciliations:'Решения о восстановлении',retries:'Решения о повторах',collection:'Результаты веток'}[kind];
      const work=descendants(box).find(n=>n.tagName==='button'&&n.textContent===label).listeners.get('click')[0](new Event('click'));
      const away=selectRun(other.id,'none');
      snapshots[0].resolve({ok:true,status:200,json:async()=>other});await away;
      const back=selectRun(base.id,'none');
      assert.equal(state.run,null);assert.ok(state.runSelection>oldVisit);
      notice('WAITING_FOR_A');
      if(mode==='failure')fail(Error('OLD_INSPECTOR_ERROR'));
      else if(mode==='401')finish({ok:false,status:401});
      else {
        const value=kind==='attempts'?{records:[],nextAfter:1,hasMore:false,missingArchived:0,
          current:{attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{}}}
          :kind==='recovery'?{attempt:1,observedAt:1,blockers:[],workspace:null}
          :kind==='reconciliations'?[]:{records:[],nextAfter:1,hasMore:false};
        finish({ok:true,status:200,json:async()=>value});
      }
      await work;
      assert.equal(state.run,null,kind);assert.equal(state.id,base.id);
      assert.equal($('notice').textContent,'WAITING_FOR_A');assert.equal(reloads,0);
      const cached=kind==='attempts'?attemptPages.get(identity):kind==='retries'?retryPages.get(identity):kind==='collection'?collectionPages.get(identity):
        kind==='recovery'?recoveryInspections.get(identity):reconciliationRecords.get(identity);
      assert.equal(cached.loading??false,false);
      if(mode==='success')assert.ok(kind==='attempts'||kind==='retries'||kind==='collection'?cached.opened:cached.value,kind);
      else assert.match(cached.error,mode==='401'?/Сессия панели изменилась/:/OLD_INSPECTOR_ERROR/);
      snapshots[1].resolve({ok:true,status:200,json:async()=>base});await back;
      assert.equal(state.run.id,base.id);assert.equal(state.runSelection,oldVisit+2);
    `,{kind,mode,other:snapshot({id:'run-other'},[])});
});

test("late recovery submit retains receipt or error without painting during the return visit load", async () => {
  for(const mode of ['success','failure','401'])await replay(`
    const activation={key:'key-operation',attempt:1,status:'failed'},identity=JSON.stringify([base.id,activation.key]);
    const inspection={value:{attempt:1,checkpoint:'checkpoint',workspace:{digest:'workspace'}},records:[]};
    const box=el('div');renderRecoveryForm(box,activation,inspection,async()=>{});
    const draft=recoveryDrafts.get(JSON.stringify([base.id,activation.key,1]));
    Object.assign(draft,{action:'retry',actor:'Reviewer',reason:'Fixture',evidence:'Inspected'});
    let finish,fail,reloads=0;const snapshots=[];
    window.location={reload(){reloads++;}};
    globalThis.fetch=(path,options)=>{
      if(path==='reconcile')return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
      if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push({path,resolve}));
      throw Error('Unexpected request '+path);
    };
    const sending=descendants(box).find(n=>n.tagName==='button'&&n.textContent==='Сохранить решение').listeners.get('click')[0](new Event('click'));
    const away=selectRun(other.id,'none');snapshots[0].resolve({ok:true,status:200,json:async()=>other});await away;
    const back=selectRun(base.id,'none');assert.equal(state.run,null);notice('WAITING_FOR_A');
    const receipt={request:{...draft.request},createdAt:3};
    if(mode==='failure')fail(Error('ORIGINAL_SUBMIT_FAILURE'));
    else if(mode==='401')finish({ok:false,status:401});
    else finish({ok:true,status:200,json:async()=>receipt});
    await sending;
    assert.equal(state.run,null);assert.equal($('notice').textContent,'WAITING_FOR_A');assert.equal(reloads,0);
    assert.equal(draft.busy,false);
    if(mode==='success'){
      assert.equal(draft.receipt.request.decisionId,draft.request.decisionId);
      assert.equal(reconciliationRecords.get(identity).value[0].request.decisionId,draft.request.decisionId);
    }else assert.match(draft.error,mode==='401'?/Сессия панели изменилась/:/ORIGINAL_SUBMIT_FAILURE/);
    snapshots[1].resolve({ok:true,status:200,json:async()=>base});await back;
    assert.equal(state.run.id,base.id);
  `,{mode,crypto:{randomUUID:()=> 'decision-4'},other:snapshot({id:'run-other'},[]),base:snapshot({status:'paused',desired:'paused'})});
});

test("identical decoded polls keep existing outline and breadcrumb handlers live", async () => {
  for(const kind of ['execution','child','breadcrumb'])await replay(`
    const parent=state.run.graphs[0].nodes[0], original=parent.activations[0];
    parent.kind='subworkflow';parent.children=[{id:'call',graphId:'child'}];
    parent.activations=[{...original,key:'parent-key',visit:1,scope:'["graph","main"]'}];
    const childScope=JSON.stringify(['graph','main','node','answer','visit','0','graph','child']);
    state.run.graphs.push({id:'child',entry:'step',nodes:[{...parent,id:'step',children:[],activations:[{...original,key:'child-key',scope:childScope}]}],edges:[]});
    if(kind==='breadcrumb'){state.graph='child';state.scope=childScope;}
    else state.node='answer';
    const fixture=JSON.parse(JSON.stringify(state.run));
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(fixture))});
    await refreshSnapshot();
    const oldRun=state.run;
    const container=kind==='breadcrumb'?$('breadcrumbs'):$('outline');
    const link=descendants(container).find(n=>n.tagName==='button'&&
      (kind==='breadcrumb'?n.textContent.includes('answer · проход'):
        kind==='execution'?n.textContent.includes('Проход 1 · попытка'):n.className.includes('child-link')));
    assert.ok(link,kind);
    await refreshSnapshot();
    assert.notEqual(state.run,oldRun);
    assert.ok(descendants(container).includes(link),'unchanged poll must leave DOM intact');
    link.dispatchEvent(new Event('click'));
    if(kind==='execution')assert.deepEqual([state.graph,state.key,state.attempt],['main','parent-key',1]);
    else if(kind==='child')assert.deepEqual([state.graph,state.scope],['child',childScope]);
    else assert.deepEqual([state.graph,state.key],['main','parent-key']);
  `,{kind});
});

test("trace source navigation clears a missing graph without losing its recorded transition", async () => {
  await replay(`
    const a=base.graphs[0].nodes[0].activations[0];
    const record={runId:base.id,seq:1,key:a.key,attempt:a.attempt,at:1,
      context:{graphId:'main',scope:JSON.parse(a.scope),visit:0},
      decision:{from:'answer',to:null,reason:'no-match',evaluations:[]}};
    state.graph='not-in-plan';state.node='answer';state.missing='Выбранный граф отсутствует в плане.';
    state.tab='trace';state.run.trace={supported:true,count:1,failed:0,lastSeq:1};
    Object.assign(tracePages.get(state.id),{opened:true,reports:[record],cursor:1,hasMore:false});
    window.location={href:'http://localhost/?run='+base.id+'&graph=not-in-plan'};
    window.history={pushState(_s,_t,url){window.location.href=String(url);},replaceState(){}};
    renderPanel();assert.match($('inspector').textContent,/граф отсутствует/);
    buttons().find(b=>b.textContent==='Показать источник на графе').dispatchEvent(new Event('click'));
    assert.deepEqual([state.tab,state.graph,state.scope,state.node,state.key,state.attempt],
      ['graph','main',a.scope,'answer',a.key,a.attempt]);
    assert.equal(state.missing,null);assert.equal(state.transition,record);
    assert.doesNotMatch($('inspector').textContent,/граф отсутствует/);
    assert.equal(new URL(window.location.href).searchParams.get('activation'),a.key);
  `,{URL});
});

test("automatic archive read does not re-enter inspector or lose focus, disclosure and one execution row", async () => {
  await replay(`
    const a=base.graphs[0].nodes[0].activations[0];
    state.key=a.key;state.attempt=1;state.scope=a.scope;state.node='answer';state.tab='graph';
    renderPanel();
    const definition=descendants($('inspector')).find(n=>n.className==='node-definition');
    definition.open=true;definition.children[0].focus();$('inspector').scrollTop=75;
    let finish,calls=0;
    const newer={...base,graphs:base.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,activations:n.activations.map(x=>({...x,attempt:2}))}))}))};
    globalThis.fetch=path=>path.startsWith('snapshot?')
      ? Promise.resolve({ok:true,status:200,json:async()=>newer})
      : path.startsWith('attempts?') ? new Promise(resolve=>{finish=resolve;calls++;}) : Promise.reject(Error(path));
    await refreshSnapshot();
    const rows=()=>descendants($('inspector')).filter(n=>n.className==='detail-run');
    const current=()=>descendants($('inspector')).find(n=>n.className==='node-definition');
    assert.equal(calls,1);assert.equal(attemptPages.get(JSON.stringify([state.id,a.key])).loading,true);
    assert.equal(rows().length,1);assert.equal(current().open,true);
    assert.equal(document.activeElement,current().children[0]);assert.equal($('inspector').scrollTop,75);
    finish({ok:true,status:200,json:async()=>({records:[{attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{},error:'ARCHIVED'}],
      current:{attempt:2,status:'succeeded',startedAt:2,finishedAt:3,metadata:{},output:{value:'LATEST'}},
      nextAfter:1,hasMore:false,missingArchived:0})});
    for(let i=0;i<25;i++)await Promise.resolve();
    assert.equal(rows().length,1);assert.equal(current().open,true);
    assert.equal(document.activeElement,current().children[0]);assert.equal($('inspector').scrollTop,75);
    assert.match($('inspector').textContent,/ARCHIVED/);assert.doesNotMatch($('inspector').textContent,/LATEST/);
    assert.equal(state.attempt,1);
  `);
});

test("late await reply cannot redraw a return visit while its snapshot is pending", async () => {
  for(const mode of ['success','failure','401'])await replay(`
    const snapshots=[];let finish,fail,reloads=0;const paths=[];
    window.location={reload(){reloads++;}};
    globalThis.fetch=path=>{
      paths.push(path);
      if(path==='resolve')return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
      if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push(resolve));
      throw Error(path);
    };
    renderPanel();fields()[0].value='{"answer":"from A"}';fields()[0].dispatchEvent(new Event('input'));
    const sending=buttons().find(b=>b.textContent==='Сохранить ответ').listeners.get('click')[0](new Event('click'));
    const away=selectRun(other.id,'none');snapshots[0]({ok:true,status:200,json:async()=>other});await away;
    const back=selectRun(base.id,'none');assert.equal(state.run,null);
    notice('AWAITING_A_SNAPSHOT');
    if(mode==='failure')fail(Error('ORIGINAL_POST_FAILED'));
    else if(mode==='401')finish({ok:false,status:401});
    else finish({ok:true,status:200,json:async()=>({})});
    await sending;renderPanel(); // Defensive entry point also refuses an unloaded visit.
    assert.equal(state.run,null);assert.equal($('notice').textContent,'AWAITING_A_SNAPSHOT');
    assert.equal(reloads,0);assert.equal(paths.filter(p=>p==='resolve').length,1);
    assert.equal(snapshots.length,2);assert.equal(waitDrafts.get(base.waits[0].id).busy,false);
    if(mode==='failure')assert.match(waitDrafts.get(base.waits[0].id).error,/ORIGINAL_POST_FAILED/);
    else if(mode==='401')assert.match(waitDrafts.get(base.waits[0].id).error,/Сессия панели изменилась/);
    else assert.equal(waitDrafts.get(base.waits[0].id).error,null);
    snapshots[1]({ok:true,status:200,json:async()=>base});await back;
    assert.equal(state.run.id,base.id);assert.equal(fields()[0].value,'{"answer":"from A"}');
  `,{mode,other:snapshot({id:'run-other'},[])});
});

test("late whole-task read cannot render tokens for an unloaded return visit", async () => {
  for(const mode of ['success','failure','401'])await replay(`
    const a={...base,lineage:{taskId:'task-A'}},b={...other,lineage:{taskId:'task-B'}};
    state.run=a;state.tab='tokens';renderPanel();
    const snapshots=[];let finish,fail,reloads=0;const requests=[];
    window.location={reload(){reloads++;}};
    globalThis.fetch=path=>{
      requests.push(path);
      if(path.startsWith('task-usage?'))return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
      if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push(resolve));
      throw Error('Unexpected request '+path);
    };
    const loading=buttons().find(n=>n.textContent==='Вся задача').listeners.get('click')[0](new Event('click'));
    const away=selectRun(b.id,'none');snapshots[0]({ok:true,status:200,json:async()=>b});await away;
    const back=selectRun(a.id,'none');notice('AWAITING_A_SNAPSHOT');
    assert.equal(state.run,null);
    if(mode==='failure')fail(Error('OLD_TASK_FAILURE'));
    else if(mode==='401')finish({ok:false,status:401});
    else finish({ok:true,status:200,json:async()=>({taskId:'task-A',summary:{totalTokens:7},runs:[]})});
    await loading;
    assert.equal(state.run,null);assert.equal($('notice').textContent,'AWAITING_A_SNAPSHOT');
    assert.equal(reloads,0);assert.equal(requests.filter(p=>p.startsWith('task-usage?')).length,1);
    assert.equal(snapshots.length,2);
    snapshots[1]({ok:true,status:200,json:async()=>a});await back;
    assert.equal(state.run.id,a.id);assert.equal(state.usageScope,'run');
  `,{mode,other:snapshot({id:'run-other'},[])});
});

test("opened live attempt page is not mistaken for an archive when a later attempt starts", async () => {
  await replay(`
    const a=base.graphs[0].nodes[0].activations[0],identity=JSON.stringify([base.id,a.key]);
    state.node='answer';state.key=a.key;state.attempt=1;state.scope=a.scope;state.tab='graph';
    Object.assign(attemptPages.get(identity),{opened:true,reports:[],cursor:0,hasMore:false});
    attemptPages.snapshots.set(identity,{current:{attempt:1,status:'running',startedAt:1,finishedAt:null,metadata:{},output:{stale:'LIVE_RESULT'}},missingArchived:0});
    renderPanel();assert.match($('inspector').textContent,/LIVE_RESULT/);
    const details=descendants($('inspector')).find(n=>n.className==='node-definition');details.open=true;details.children[0].focus();
    const updated={...base,graphs:base.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,activations:n.activations.map(x=>({...x,attempt:2,status:'succeeded'}))}))}))};
    let finish,calls=0;
    globalThis.fetch=path=>path.startsWith('snapshot?')?Promise.resolve({ok:true,status:200,json:async()=>updated})
      :path.startsWith('attempts?')?new Promise(resolve=>{finish=resolve;calls++;assert.match(path,/after=0/);}):Promise.reject(Error(path));
    await refreshSnapshot();
    const text=$('inspector').textContent;
    assert.equal(calls,1);assert.equal(attemptPages.get(identity).loading,true);
    assert.doesNotMatch(text,/LIVE_RESULT|Попытка 1 · последняя|Выбранная попытка не сохранена/);
    assert.match(text,/прежний живой снимок не является её архивом/);
    assert.equal(descendants($('inspector')).filter(n=>n.className==='detail-run').length,1);
    assert.equal(descendants($('inspector')).find(n=>n.className==='node-definition').open,true);
    assert.equal(document.activeElement,descendants($('inspector')).find(n=>n.className==='node-definition').children[0]);
    finish({ok:true,status:200,json:async()=>({records:[{attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{},error:'ARCHIVED_FAILURE'}],
      current:{attempt:2,status:'succeeded',startedAt:2,finishedAt:3,metadata:{},output:{value:'NEW_RESULT'}},
      nextAfter:1,hasMore:false,missingArchived:0})});
    for(let i=0;i<25;i++)await Promise.resolve();
    const final=$('inspector').textContent;
    assert.match(final,/ARCHIVED_FAILURE/);assert.doesNotMatch(final,/LIVE_RESULT|NEW_RESULT|Попытка 1 · последняя/);
    assert.equal(descendants($('inspector')).filter(n=>n.className==='detail-run').length,1);
    assert.equal(attemptPages.snapshots.get(identity).current.attempt,2);
    assert.equal(document.activeElement,descendants($('inspector')).find(n=>n.className==='node-definition').children[0]);
  `);
});

test("scope-specific outline and graph agree when sibling outcomes diverge", async () => {
  await replay(`
    const scope=branch=>JSON.stringify(['graph','main','node','fan','visit','0','parallel',branch,'graph','child']);
    const first={...base.graphs[0].nodes[0].activations[0],scope:scope('correctness'),key:'failed-key',status:'failed'};
    const second={...first,key:'successful-key',scope:scope('security'),status:'succeeded'};
    state.run.graphs.push({id:'child',entry:'review',edges:[],nodes:[{...base.graphs[0].nodes[0],id:'review',status:'succeeded',activations:[first,second],branches:2}]});
    state.graph='child';state.tab='graph';state.scope=scope('correctness');renderPanel();
    const status=()=>descendants($('outline')).find(n=>n.className.startsWith('status-dot')).className;
    const graphNode=()=>descendants($('graph')).find(n=>n.getAttribute('role')==='button').getAttribute('class');
    assert.equal(selectedGraph().nodes[0].status,'failed');assert.match(status(),/failed/);assert.match(graphNode(),/failed/);
    assert.doesNotMatch(status(),/succeeded|running/);
    state.scope=scope('security');renderPanel();
    assert.equal(selectedGraph().nodes[0].status,'succeeded');assert.match(status(),/succeeded/);assert.match(graphNode(),/succeeded/);
    state.scope='';renderPanel();
    assert.match(status(),/succeeded/,'aggregate state belongs only to all-calls view');
  `);
});

test("no-match trace explains absence of a fallback rather than claiming its use", async () => {
  await replay(`
    state.tab='trace';state.run.trace={supported:true,count:1,failed:0,lastSeq:1};
    state.run.graphs[0].edges=[{from:'answer',to:'next',condition:{op:'literal',value:false},conditional:true}];
    const record={seq:1,at:1,key:'key-correctness',attempt:1,context:{graphId:'main',scope:[],visit:0},
      decision:{from:'answer',to:null,reason:'no-match',evaluations:[{edgeIndex:0,to:'next',result:'false'}]}};
    Object.assign(tracePages.get(state.id),{opened:true,reports:[record],cursor:1,hasMore:false});
    renderPanel();
    assert.match($('content-panel').textContent,/Ни одно условие не выбрало путь/);
    assert.match($('content-panel').textContent,/запасной переход отсутствует/);
    state.tab='history';renderPanel();
    assert.match($('content-panel').textContent,/подходящий переход не найден/);
    state.tab='trace';renderPanel();
    assert.doesNotMatch($('content-panel').textContent,/использован запасной переход|Безусловный запасной переход/);
    record.decision={...record.decision,to:'next',reason:'fallback'};renderPanel();
    assert.match($('content-panel').textContent,/использован запасной переход/);
  `);
});

test("attempt API ahead of the run snapshot does not relaunch automatic reads or mislabel the future attempt", async () => {
  await replay(`
    const a=state.run.graphs[0].nodes[0].activations[0];a.attempt=2;
    state.key=a.key;state.attempt=1;state.node='answer';state.scope=a.scope;
    const identity=JSON.stringify([state.id,a.key]);
    Object.assign(attemptPages.get(identity),{opened:true,cursor:1,reports:[],hasMore:false});
    attemptPages.snapshots.set(identity,{current:{attempt:3,status:'succeeded',startedAt:3,finishedAt:4,metadata:{},output:{future:'FUTURE_RESULT'}},missingArchived:0});
    let reads=0;globalThis.fetch=()=>{reads++;throw Error('Unexpected automatic repeat');};
    renderPanel();renderPanel();
    assert.equal(reads,0);
    assert.match($('inspector').textContent,/Данные попыток новее снимка выполнения/);
    assert.doesNotMatch($('inspector').textContent,/FUTURE_RESULT|Попытка 3 · последняя/);
    state.key=null;state.attempt=null;renderPanel();
    const future=descendants($('inspector')).find(n=>n.className==='attempt-card');
    assert.match(future.textContent,/Попытка 3 · страница попыток опережает общий снимок/);
    assert.equal(future.getAttribute('data-selected'),'false');
    assert.equal(descendants(future).filter(n=>n.tagName==='button').length,0);
    assert.equal(reads,0);
  `);
});

test("shared inspector pages settle into the displayed A after A → B → A without waiting for a changed poll", async () => {
  for(const kind of ['attempts','recovery','reconciliations','retries','collection'])
    for(const mode of ['success','failure','401'])await replay(`
      const a=base.graphs[0].nodes[0].activations[0];
      const run={...base,status:'failed',graphs:base.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,
        status:'failed',failurePolicy:'collect',retryPolicy:{codes:[],delayMs:0},
        activations:n.activations.map(item=>({...item,status:'failed'}))}))}))};
      const otherRun=other,identity=JSON.stringify([base.id,a.key]);
      state.run=run;state.graph='main';state.node='answer';state.scope=a.scope;state.key=a.key;state.attempt=1;state.tab='graph';
      const route=locationFor('http://localhost/',{id:base.id,graph:'main',scope:a.scope,node:'answer',key:a.key,attempt:1,tab:'graph'}).href;
      window.location={href:route,reload(){reloads++;}};
      window.history={pushState(_s,_t,url){window.location.href=String(url)},replaceState(){}};
      let finish,fail,reloads=0;const snapshots=[];
      const prefix={attempts:'attempts?',recovery:'recovery?',reconciliations:'reconciliations?',retries:'retries?',collection:'collections?'}[kind];
      globalThis.fetch=path=>{
        if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push(resolve));
        if(path.startsWith(prefix))return new Promise((resolve,reject)=>{finish=resolve;fail=reject});
        if(kind==='recovery'&&path.startsWith('reconciliations?'))return Promise.resolve({ok:true,status:200,json:async()=>[]});
        throw Error('Unexpected '+path);
      };
      renderPanel();
      const labels={attempts:'Попытки: 1',recovery:'Проверить состояние для восстановления',reconciliations:'Решения о восстановлении',
        retries:'Решения о повторах',collection:'Результаты веток'};
      const button=()=>descendants($('inspector')).find(n=>n.tagName==='button'&&n.textContent===labels[kind]);
      assert.ok(button(),kind);
      const reading=button().listeners.get('click')[0](new Event('click'));
      const away=selectRun(otherRun.id,'none');snapshots[0]({ok:true,status:200,json:async()=>otherRun});await away;
      window.location.href=route;
      const back=selectRun(base.id,'pop');snapshots[1]({ok:true,status:200,json:async()=>run});await back;
      const before=descendants($('inspector')).find(n=>n.tagName==='button'&&
        (n.textContent.startsWith('Загружаем')||n.textContent.startsWith('Сканирование состояния')));
      assert.ok(before&&before.disabled,kind+' should visibly be loading');
      const value=kind==='attempts'?{records:[],nextAfter:0,hasMore:false,missingArchived:0,
          current:{attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{},output:{saved:'ATTEMPT_RESULT'}}}
        :kind==='recovery'?{attempt:1,observedAt:1,blockers:[],workspace:null}
        :kind==='reconciliations'?[]:{records:[],nextAfter:0,hasMore:false};
      if(mode==='failure')fail(Error('ORIGINAL_PAGE_FAILURE'));
      else if(mode==='401')finish({ok:false,status:401});
      else finish({ok:true,status:200,json:async()=>value});
      await reading;
      assert.equal(reloads,0);assert.equal(state.run.id,base.id);
      const inspector=$('inspector').textContent;
      assert.doesNotMatch(inspector,/Загружаем попытки|Загружаем решения|Загружаем результаты|Сканирование состояния/);
      if(mode==='success'){
        if(kind==='attempts')assert.match(inspector,/ATTEMPT_RESULT/);
        else if(kind==='recovery')assert.match(inspector,/Инспекция · попытка 1/);
        else if(kind==='reconciliations')assert.match(inspector,/Сохранённых решений нет/);
        else assert.match(inspector,/Обновить решения о повторах|Обновить результаты веток/);
      }else assert.match(inspector,mode==='401'?/Сессия панели изменилась/:/ORIGINAL_PAGE_FAILURE/);
      const load=descendants($('inspector')).find(n=>n.tagName==='button'&&
        (kind==='attempts'?n.textContent==='Обновить попытки'||n.textContent==='Попытки: 1':kind==='recovery'?n.textContent==='Обновить инспекцию'||n.textContent==='Проверить состояние для восстановления':
          kind==='reconciliations'?n.textContent==='Обновить решения о восстановлении'||n.textContent==='Решения о восстановлении':
          kind==='retries'?n.textContent==='Обновить решения о повторах'||n.textContent==='Решения о повторах':
          n.textContent==='Обновить результаты веток'||n.textContent==='Результаты веток'));
      assert.ok(load&&!load.disabled,kind+' must offer an enabled refresh');
      const after=inspector;
      globalThis.fetch=async()=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(run))});
      await refreshSnapshot();
      assert.equal($('inspector').textContent,after,'unchanged poll must not be needed to unstick cache');
    `,{kind,mode,URL,other:snapshot({id:'run-other'},[])});
});

test("return visit does not redraw a different inspector when an old activation page settles", async () => {
  await replay(`
    const a=base.graphs[0].nodes[0].activations[0];
    const main=base.graphs[0];
    const otherNode={...main.nodes[0],id:'other',activations:[{...a,key:'other-key'}]};
    const original={...base,graphs:[{...main,nodes:[...main.nodes,otherNode]}]};
    state.run=original;state.node='answer';state.scope=a.scope;state.key=a.key;state.attempt=1;state.tab='history';
    renderPanel();
    const snapshots=[];let finish;
    globalThis.fetch=path=>path.startsWith('snapshot?')?new Promise(resolve=>snapshots.push(resolve)):
      path.startsWith('attempts?')?new Promise(resolve=>{finish=resolve;}):Promise.reject(Error(path));
    const load=descendants($('inspector')).find(n=>n.tagName==='button'&&n.textContent==='Попытки: 1');
    const reading=load.listeners.get('click')[0](new Event('click'));
    const away=selectRun(other.id,'none');snapshots[0]({ok:true,status:200,json:async()=>other});await away;
    const route=locationFor('http://localhost/',{id:base.id,graph:'main',scope:a.scope,node:'other',key:'other-key',attempt:1,tab:'history'}).href;
    window.location={href:route};
    const back=selectRun(base.id,'pop');snapshots[1]({ok:true,status:200,json:async()=>original});await back;
    assert.equal(state.key,'other-key');
    const existing=$('inspector').children[0];
    finish({ok:true,status:200,json:async()=>({records:[],nextAfter:0,hasMore:false,
      current:{attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{},output:{value:'OLD_ACTIVATION'}}})});
    await reading;
    assert.equal($('inspector').children[0],existing);
    assert.doesNotMatch($('inspector').textContent,/OLD_ACTIVATION/);
    assert.equal(attemptPages.get(JSON.stringify([base.id,a.key])).loading,false);
  `,{URL,other:snapshot({id:'run-other'},[])});
});

test("settled await POST releases the same loaded return form without another submission", async () => {
  for(const mode of ['success','network','http-400','401'])await replay(`
    const a=base,b=other;
    const snapshots=[];let finish,fail,reloads=0;const paths=[],posts=[];
    window.location={reload(){reloads++;}};
    globalThis.fetch=(path,options)=>{
      paths.push(path);
      if(path==='resolve') {posts.push(JSON.parse(options.body));return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});}
      if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push(resolve));
      throw Error(path);
    };
    renderPanel();fields()[0].value='{"answer":"SENT"}';fields()[0].dispatchEvent(new Event('input'));
    const sending=buttons().find(n=>n.textContent==='Сохранить ответ').listeners.get('click')[0](new Event('click'));
    const away=selectRun(b.id,'none');snapshots[0]({ok:true,status:200,json:async()=>b});await away;
    const back=selectRun(a.id,'none');snapshots[1]({ok:true,status:200,json:async()=>a});await back;
    assert.ok(buttons().some(n=>n.textContent==='Сохраняем…'&&n.disabled));
    fields()[0].value='{"answer":"RETURN_DRAFT"}';fields()[0].dispatchEvent(new Event('input'));fields()[0].focus();
    if(mode==='network')fail(Error('NETWORK_POST_ERROR'));
    else if(mode==='http-400')finish({ok:false,status:400,json:async()=>({error:'VALIDATION_ERROR'})});
    else if(mode==='401')finish({ok:false,status:401});
    else finish({ok:true,status:200,json:async()=>({})});
    await sending;
    assert.equal(state.run.id,a.id);assert.equal(state.tab,'now');assert.equal(reloads,0);
    assert.equal(posts.length,1);assert.equal(posts[0].response.answer,'SENT');
    assert.equal(fields()[0].value,'{"answer":"RETURN_DRAFT"}');assert.equal(document.activeElement,fields()[0]);
    assert.ok(buttons().some(n=>n.textContent==='Сохранить ответ'&&!n.disabled));
    const error={network:'NETWORK_POST_ERROR','http-400':'VALIDATION_ERROR','401':'Сессия панели изменилась'}[mode];
    if(error)assert.ok($('content-panel').textContent.includes(error),mode);
    else assert.equal(waitDrafts.get(a.waits[0].id).error,null);
    assert.equal(paths.filter(path=>path==='resolve').length,1);
    const visible=$('content-panel').textContent;
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(a))});
    await refreshSnapshot();assert.equal($('content-panel').textContent,visible);
  `,{mode,other:snapshot({id:'run-other'},[])});
});

test("trace cache completion updates a loaded return in trace, history and inspector without a changed snapshot", async () => {
  for(const view of ['trace','history','inspector'])for(const mode of ['success','http-400','401'])await replay(`
    const a=base.graphs[0].nodes[0].activations[0];
    const run={...base,trace:{supported:true,count:1,failed:0,lastSeq:1}},b=other;
    state.run=run;state.tab=view==='inspector'?'graph':view;
    if(view==='inspector'){state.graph='main';state.node='answer';state.scope=a.scope;state.key=a.key;state.attempt=1;}
    Object.assign(tracePages.get(base.id),{opened:true,reports:[],cursor:0,hasMore:true});
    const route=locationFor('http://localhost/',{id:base.id,tab:state.tab,graph:state.graph,scope:state.scope,
      node:state.node,key:state.key,attempt:state.attempt}).href;
    let reloads=0,finish;const snapshots=[],paths=[];
    window.location={href:route,reload(){reloads++;}};
    globalThis.fetch=path=>{
      paths.push(path);
      if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push(resolve));
      if(path.startsWith('trace?'))return new Promise(resolve=>{finish=resolve});
      throw Error(path);
    };
    renderPanel();
    const panel=()=>view==='inspector'?$('inspector'):$('content-panel');
    const button=descendants(panel()).find(n=>n.tagName==='button'&&
      (view==='trace'?n.textContent==='Загрузить следующие переходы':n.textContent==='Ещё причины переходов'));
    assert.ok(button,view);
    const loading=button.listeners.get('click')[0](new Event('click'));
    const away=selectRun(b.id,'none');snapshots[0]({ok:true,status:200,json:async()=>b});await away;
    window.location.href=route;
    const back=selectRun(base.id,'pop');snapshots[1]({ok:true,status:200,json:async()=>run});await back;
    assert.equal(state.id,base.id);assert.equal(state.tab,view==='inspector'?'graph':view);
    assert.ok(panel().textContent.includes(view==='trace'?'Загружаем переходы…':'Загрузка…'),view);
    const record={seq:1,runId:base.id,key:a.key,attempt:1,at:1,
      context:{graphId:'main',scope:JSON.parse(a.scope),visit:0},
      decision:{from:'answer',to:null,reason:'no-match',evaluations:[]}};
    if(mode==='401')finish({ok:false,status:401});
    else if(mode==='http-400')finish({ok:false,status:400,json:async()=>({error:'TRACE_PAGE_ERROR'})});
    else finish({ok:true,status:200,json:async()=>({records:[record],nextAfter:1,hasMore:false})});
    if(loading)await loading;for(let i=0;i<25;i++)await Promise.resolve();
    assert.equal(tracePages.get(base.id).loading,false);assert.equal(reloads,0);
    assert.equal(paths.filter(path=>path.startsWith('trace?')).length,1);
    assert.doesNotMatch(panel().textContent,/Загружаем переходы…|Загрузка…/);
    if(mode==='success')assert.ok(panel().textContent.includes(view==='trace'?'запасной переход отсутствует':'подходящий переход не найден'),view);
    else assert.ok(panel().textContent.includes(mode==='401'?'Сессия панели изменилась':'TRACE_PAGE_ERROR'),view);
    const enabled=descendants(panel()).find(n=>n.tagName==='button'&&
      (view==='trace'?n.textContent==='Загрузить следующие переходы'||n.textContent==='Повторить загрузку':
        n.textContent==='Обновить причины переходов'||n.textContent==='Ещё причины переходов'));
    if(view==='trace'&&mode==='success')assert.equal(enabled,undefined,'completed trace needs no page button');
    else assert.ok(enabled&&!enabled.disabled,view+' must release the loader');
    const shown=panel().textContent;
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(run))});
    await refreshSnapshot();assert.equal(panel().textContent,shown);
  `,{view,mode,URL,other:snapshot({id:'run-other'},[])});
});

test("run and task usage pages release the loaded return view when their old GET settles", async () => {
  for(const scope of ['run','task'])for(const mode of ['success','http-400','401'])await replay(`
    const task=scope==='task';
    const a=task?{...base,lineage:{taskId:'shared-task'}}:base;
    const b=task?{...other,lineage:{taskId:'shared-task'}}:other;
    state.run=a;state.runs=[a,b];state.tab='tokens';
    if(task){state.usageScope='task';state.taskUsage={taskId:'shared-task',summary:a.usage,runs:[],reusedOutputs:0};}
    const route=locationFor('http://localhost/',{id:a.id,tab:'tokens',graph:'main',scope:''}).href;
    let finish,reloads=0,taskCalls=0;const snapshots=[],requests=[];
    window.location={href:route,reload(){reloads++;}};
    globalThis.fetch=path=>{
      requests.push(path);
      if(path.startsWith('snapshot?'))return new Promise(resolve=>snapshots.push(resolve));
      if(path.startsWith('usage?')||path.startsWith('task-usage?')){
        if(!task||++taskCalls===1)return new Promise(resolve=>{finish=resolve;});
        return Promise.resolve({ok:true,status:200,json:async()=>({taskId:'shared-task',summary:a.usage,runs:[],reusedOutputs:0,reports:[],nextAfter:0,hasMore:false})});
      }
      if(path.startsWith('task?'))return Promise.resolve({ok:true,status:200,json:async()=>({members:[]})});
      throw Error('Unexpected '+path);
    };
    renderPanel();
    const start=buttons().find(n=>n.textContent==='Показать исходные отчёты ответов');assert.ok(start);
    const loading=start.listeners.get('click')[0](new Event('click'));
    const away=selectRun(b.id,'none');snapshots[0]({ok:true,status:200,json:async()=>b});await away;
    window.location.href=route;
    const back=selectRun(a.id,'pop');snapshots[1]({ok:true,status:200,json:async()=>a});await back;
    assert.equal(state.usageScope,task?'task':'run');
    assert.ok(buttons().some(n=>n.textContent==='Загрузка…'&&n.disabled));
    if(mode==='401')finish({ok:false,status:401});
    else if(mode==='http-400')finish({ok:false,status:400,json:async()=>({error:'USAGE_PAGE_ERROR'})});
    else finish({ok:true,status:200,json:async()=>({reports:[{runId:a.id,key:a.graphs[0].nodes[0].activations[0].key,
      reportId:'REPORT_READY',attempt:1,usage:{input:2,output:3,totalTokens:5},stopReason:'stop'}],nextAfter:1,hasMore:false})});
    await loading;
    assert.equal(usagePages.get(task?'task:shared-task':a.id).loading,false);
    assert.equal(reloads,0);
    assert.doesNotMatch($('content-panel').textContent,/Загрузка…/);
    if(mode==='success')assert.match($('content-panel').textContent,/REPORT_READY/);
    else assert.match($('content-panel').textContent,mode==='401'?/Сессия панели изменилась/:/USAGE_PAGE_ERROR/);
    assert.ok(buttons().some(n=>(n.textContent==='Проверить новые отчёты'||n.textContent==='Показать исходные отчёты ответов')&&!n.disabled));
    const shown=$('content-panel').textContent;
    globalThis.fetch=path=>path.startsWith('snapshot?')?Promise.resolve({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(a))}):
      path.startsWith('task-usage?')?Promise.resolve({ok:true,status:200,json:async()=>({taskId:'shared-task',summary:a.usage,runs:[],reusedOutputs:0,reports:[],nextAfter:0,hasMore:false})}):
      path.startsWith('task?')?Promise.resolve({ok:true,status:200,json:async()=>({members:[]})}):Promise.reject(Error(path));
    await refreshSnapshot();for(let i=0;i<12;i++)await Promise.resolve();
    assert.equal($('content-panel').textContent,shown);
  `,{scope,mode,URL,other:snapshot({id:'run-other'},[])});
});

test("findings-only succeeded review remains visible in graph, issues history and inspector", async () => {
  const review: ActivationRecord = { ...activation("correctness"), status: "succeeded", finishedAt: 2,
    output: { summary: "Review complete", findings: ["Missing validation"] }, metadata: {} };
  const base = graphSnapshot({ ...run, status: "succeeded", updatedAt: 2 }, [review], new Map(), []);
  assert.deepEqual(base.graphs[0]!.nodes[0]!.activations[0]!.findings, ["Missing validation"]);
  base.graphs[0]!.nodes[0]!.kind = "agent";
  base.graphs[0]!.nodes[0]!.role = "reviewer";
  await replay(`
    state.tab='graph';renderPanel();
    const graphNode=descendants($('graph')).find(n=>n.getAttribute('role')==='button');
    assert.match(graphNode.getAttribute('class'),/attention/);
    assert.match(graphNode.textContent,/Есть замечания/);
    assert.equal(state.run.graphs[0].nodes[0].activations[0].status,'succeeded');
    setTab('history');
    const filter=descendants($('content-panel')).find(n=>n.getAttribute('aria-label')==='Фильтр истории');
    filter.value='issues';filter.dispatchEvent(new Event('change'));
    const rows=descendants($('content-panel')).filter(n=>n.className==='task-row');
    assert.equal(rows.length,1);assert.match(rows[0].textContent,/Review complete/);
    assert.doesNotMatch(rows[0].textContent,/request_changes|rejected|exit [1-9]/);
    await descendants(rows[0]).find(n=>n.tagName==='button').listeners.get('click')[0](new Event('click'));
    assert.match($('inspector').textContent,/Замечания: 1/);
    assert.match($('inspector').textContent,/Missing validation/);
  `, { base });
});

test("history filter keeps keyboard focus and scroll through both filter changes", async () => {
  await replay(`
    state.tab='history';renderPanel();
    const filters=()=>descendants($('content-panel')).filter(n=>n.tagName==='select'&&n.getAttribute('aria-label')==='Фильтр истории');
    const first=filters()[0];first.focus();$('content-panel').scrollTop=85;
    first.value='issues';first.dispatchEvent(new Event('change'));
    const second=filters()[0];
    assert.notEqual(second,first);assert.equal(state.filter,'issues');assert.equal(second.value,'issues');
    assert.equal(document.activeElement,second);assert.equal($('content-panel').scrollTop,85);
    second.value='agent';second.dispatchEvent(new Event('change'));
    const third=filters()[0];
    assert.notEqual(third,second);assert.equal(state.filter,'agent');assert.equal(third.value,'agent');
    assert.equal(document.activeElement,third);assert.equal($('content-panel').scrollTop,85);
  `);
});
