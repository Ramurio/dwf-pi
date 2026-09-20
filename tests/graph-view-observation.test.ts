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
  replaceChildren(...nodes: Element[]) { this.ownText = ""; this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = String(value); if (key === "class") this.className = String(value); }
  getAttribute(key: string) { return key === "class" ? this.className : this.attributes[key]; }
  addEventListener(name: string, fn: (event: Event) => unknown) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  dispatchEvent(event: Event) { for (const fn of this.listeners.get(event.type) ?? []) fn(event); return !event.defaultPrevented; }
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
  })()`, { ...pages, ...taskScope, layoutGraph, document, Event, assert, base: snapshot(), ...fixtures,
    window: { addEventListener() {} }, ResizeObserver: class { observe() {} }, fetch() { throw new Error("Unexpected request"); } });
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
      assert.deepEqual(reconciliationRecords.get(JSON.stringify([base.id,activation.key])).value,[receipt]);
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
    const runLabels = $('runs').children.map(item => item.children.find(child => child.className === 'mini-id').textContent);
    for (const text of runLabels.slice(0, 2)) { assert.match(text, /Нет отчётов/); assert.doesNotMatch(text, /0 ток/); }
    for (const index of [2, 4]) assert.match(runLabels[index], /· 0 ток\\.$/);
    assert.match(runLabels[3], /10 ток.*[Ии]звестная часть/);
  `, { summaries });
});
