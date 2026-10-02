import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { runInNewContext } from "node:vm";
import test from "node:test";
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

const root = new URL("../src/graph-view/", import.meta.url);
// Only disable network startup/polling. All UI functions and event registrations run unchanged.
const source = readFileSync(new URL("app.js", root), "utf8");
const boundary = "await refreshRuns();\nlet tick = 0;";
assert.equal(source.split(boundary).length, 2, "startup boundary must exist exactly once");
const app = source.split(boundary)[0]!;
const replay = `
const check = (value, message) => { if (!value) throw new Error(message); };
const descendants = node => Array.from(node.children).flatMap(child => [child, ...descendants(child)]);
const clicks = (node, text) => descendants(node).find(n => n.tagName.toLowerCase() === 'button' && n.textContent === text).click();
const scopes = ['A', 'B'].map(branch => [{ graphId: 'main', nodeId: 'fan', branch }]);
const records = scopes.map((scope, i) => ({ runId: 'fixture', context: { graphId: 'main', scope, visit: 0 }, attempt: 1, at: 0,
  decision: { from: 'route', to: 'end', edgeIndex: 0, reason: 'condition', evaluations: [{ edgeIndex: 0, to: 'end', result: i ? 'fallback' : 'true' }] } }));
const nodes = ['route', 'end'].map(id => ({ id, kind: 'branch', status: 'succeeded', branches: 2, children: [],
  activations: scopes.map((scope, i) => ({ key: id + i, scope: JSON.stringify(scope), path: 'branch ' + i + ' / ' + id,
    status: 'succeeded', findings: [], startedAt: 0, finishedAt: 1, attempt: 1 })) }));
$('workspace').hidden = false;
state.id = 'fixture'; state.graph = 'main';
state.run = { outputs: { flag: 'historical-operand' }, entryGraph: 'main', trace: { supported: true, count: 2, failed: 0, lastSeq: 2 },
 graphs: ['main', 'other'].map(id => ({ id, entry: 'route', nodes, edges: [{ from: 'route', to: 'end', conditional: true, condition: { eq: ['output.flag', true] } }] })) };
Object.assign(tracePages.get(state.id), { opened: true, reports: records, cursor: 2 });
const graphNodes = () => descendants($('graph')).filter(n => n.getAttribute('role') === 'button');
const pressed = id => {
 const current = graphNodes();
 check(current.length === nodes.length, 'node count');
 current.forEach((g, i) => {
  const expected = nodes[i].id === id;
  check(g.getAttribute('aria-pressed') === String(expected), 'aria-pressed mismatch: ' + nodes[i].id);
  check(g.getAttribute('class').split(' ').includes('selected') === expected, 'CSS/ARIA mismatch');
 });
};
renderPanel(); pressed(null);
const selected = expected => {
 pressed(state.node);
 const shown = $('inspector').textContent.includes('ВЫБРАННЫЙ ПЕРЕХОД');
 const paths = descendants($('graph')).filter(n => (n.getAttribute('class') || '').split(' ').includes('trace-selected'));
 check(shown === expected, 'inspector selection mismatch');
 check(paths.length === (expected ? 1 : 0), 'SVG selection mismatch');
};
const choose = i => { setTab('trace'); const cards = Array.from($('content-panel').children).filter(n => n.className.includes('trace-card'));
 clicks(cards[i], 'Показать источник на графе'); selected(true); check(state.transition === records[i], 'wrong trace'); };
const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change')); check(state.transition === null, 'dropdown must clear transition'); selected(false); };
choose(0);
renderPanel(); selected(true); check(state.transition === records[0], 'same-scope render lost trace');
change('scope-select', JSON.stringify(scopes[1]));
check(state.node === 'route' && state.graph === 'main', 'scope navigation changed node/graph');
choose(1); check($('inspector').textContent.includes('Выбран запасной переход'), 'B durable result absent');
change('scope-select', '');
choose(0); change('graph-select', 'other');
check(state.node === null, 'graph navigation must clear node');
// Guards must also work independently of dropdown invalidation.
state.node = 'route'; state.scope = JSON.stringify(scopes[0]); state.transition = records[0]; renderPanel(); selected(false);
state.graph = 'main'; state.scope = JSON.stringify(scopes[1]); renderPanel(); selected(false);
state.scope = ''; renderPanel(); selected(false);
choose(1);
const sourceNode = descendants($('graph')).find(n => (n.getAttribute('aria-label') || '').includes(': route,'));
sourceNode.dispatchEvent(new Event('click')); check(state.transition === null, 'selectNode must clear trace'); selected(false);
choose(1); renderPanel(); selected(true);
state.node = 'end'; renderInspector();
check(!$('inspector').textContent.includes('ВЫБРАННЫЙ ПЕРЕХОД'), 'inspector accepted wrong source node');
state.node = 'route'; renderPanel(); selected(true);
check(!$('inspector').textContent.includes('historical-operand'), 'invented operand');
// Exercise the production keyboard listener with cancelable events, not selectNode().
for (const key of ['x', 'Enter', ' ']) {
 choose(0);
 const event = new Event('keydown', { cancelable: true });
 Object.defineProperty(event, 'key', { value: key });
 const result = graphNodes()[1].dispatchEvent(event);
 check(event.defaultPrevented === (key !== 'x') && result === (key === 'x'), 'keyboard cancellation');
 pressed(key === 'x' ? 'route' : 'end');
 selected(key === 'x');
 check($('inspector').textContent.includes(key === 'x' ? 'route' : 'end'), 'keyboard inspector');
}
// Text boundaries and hostile strings must remain literal in both accessible names.
const payload = '<script>alert("x")</script><img onerror="x">&';
const textNodes = [
 ['short', 'short'], ['i'.repeat(30), 't'.repeat(25)],
 ['i'.repeat(31), 't'.repeat(26)], [payload + 'id', payload + 'title'],
].map(([id, role]) => ({ id, role, kind: 'branch', status: 'running', branches: 0, children: [], activations: [] }));
state.scope = ''; state.node = null; state.transition = records[0];
state.run.graphs.forEach(g => { g.nodes = textNodes; g.entry = textNodes[0].id; g.edges = []; });
const originalText = JSON.stringify(textNodes);
for (let repeat = 0; repeat < 2; repeat++) {
 renderPanel();
 graphNodes().forEach((g, i) => {
  const n = textNodes[i], children = Array.from(g.children);
  const titles = children.filter(c => c.tagName.toLowerCase() === 'title');
  check(titles.length === 1 && children[0] === titles[0], 'one direct first title');
  check(titles[0].textContent.includes(n.role) && titles[0].textContent.includes(n.id), 'full tooltip');
  check(g.getAttribute('aria-label') === n.role + ': ' + n.id + ', последнее состояние узла: В работе', 'full aria label');
  for (const [cls, value, limit] of [['node-title', n.role, 25], ['node-meta', n.id, 30]]) {
   const text = children.find(c => c.getAttribute('class') === cls).textContent;
   check(text === (value.length > limit ? value.slice(0, limit - 1) + '…' : value), 'visible shortening');
  }
  check(g.getAttribute('aria-pressed') === 'false', 'running/trace is not selected');
  check(descendants(g).every(c => ['title', 'rect', 'text'].includes(c.tagName.toLowerCase())), 'injected element');
 });
}
check(JSON.stringify(textNodes) === originalText, 'snapshot text mutated');
graphNodes()[0].dispatchEvent(new Event('click')); renderPanel();
check(graphNodes()[0].getAttribute('aria-pressed') === 'true', 'redraw lost selection');
graphNodes()[0].setAttribute('aria-pressed', 'false'); renderPanel();
check(graphNodes()[0].getAttribute('aria-pressed') === 'true', 'DOM became selection cache');
// Only explicitly queued GET snapshots are allowed. Await both current and stale responses.
const fixture = id => ({ ...state.run, id, name: id, status: 'succeeded', cwd: '/fixture',
 createdAt: 0, updatedAt: 1, activeKeys: [], usage: { reported: 0, partial: false, totalTokens: 0 },
 presentation: { statusLabel: 'Done', liveness: { label: 'offline' } } });
const a = fixture('A'), b = fixture('B');
const pending = [], unexpectedRequests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (path, options) => new Promise((resolve, reject) => {
 const expected = pending.shift();
 if (!expected || path !== 'snapshot?id=' + expected.id || options.method) {
  unexpectedRequests.push(path); reject(new Error('Unexpected fixture request: ' + path)); return;
 }
 expected.resolve = value => resolve({ ok: true, status: 200, json: async () => value });
});
try {
 const requestA = { id: 'A' }; pending.push(requestA);
 const loadingA = selectRun('A', 'none');
 check($('workspace').hidden && state.node === null, 'run load must hide old selection');
 requestA.resolve(a); await loadingA;
 check(state.run.id === 'A' && !$('workspace').hidden, 'A snapshot failed');
 check(graphNodes().every(n => n.getAttribute('aria-pressed') === 'false'), 'selection leaked into A');
 graphNodes()[0].dispatchEvent(new Event('click'));
 const redraw = { id: 'A' }; pending.push(redraw); const redrawing = refreshSnapshot();
 redraw.resolve({ ...a, updatedAt: 2 }); await redrawing;
 check(graphNodes()[0].getAttribute('aria-pressed') === 'true', 'current snapshot lost selection');
 const stale = { id: 'A' }; pending.push(stale); const refreshing = refreshSnapshot();
 const requestB = { id: 'B' }; pending.push(requestB); const loadingB = selectRun('B', 'none');
 check($('workspace').hidden && state.node === null, 'B loading selection');
 requestB.resolve(b); await loadingB;
 check(state.run.id === 'B' && !$('workspace').hidden, 'B snapshot failed');
 check(graphNodes().every(n => n.getAttribute('aria-pressed') === 'false'), 'selection leaked into B');
 graphNodes()[1].dispatchEvent(new Event('click')); const before = $('graph').textContent;
 stale.resolve(a); await refreshing;
 check(state.id === 'B' && state.run.id === 'B' && $('graph').textContent === before, 'stale snapshot applied');
 check(graphNodes()[1].getAttribute('aria-pressed') === 'true', 'stale redraw lost selection');
 check(pending.length === 0, 'unconsumed fixture reads');
 check(unexpectedRequests.length === 0, 'unexpected network requests');
} finally { globalThis.fetch = originalFetch; }
document.body.setAttribute('data-replay', 'passed');
`;

// Small deterministic DOM adapter; no UI function is mocked. A real browser replay below
// runs the identical scenario against index.html and native events when Chrome is installed.
class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  className = "";
  value = "";
  ownText = "";
  listeners = new Map<string, ((event: Event) => void)[]>();
  set innerHTML(_value: string) { throw new Error("HTML insertion forbidden"); }
  insertAdjacentHTML() { throw new Error("HTML insertion forbidden"); }
  constructor(public tagName = "div") {}
  set textContent(value: string) { this.ownText = String(value); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(n => n.textContent).join(""); }
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.ownText = ""; this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = String(value); if (key === "class") this.className = String(value); }
  getAttribute(key: string) { return key === "class" ? this.className : this.attributes[key]; }
  addEventListener(name: string, fn: (event: Event) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  dispatchEvent(event: Event) { for (const fn of this.listeners.get(event.type) ?? []) fn(event); return !event.defaultPrevented; }
  click() { this.dispatchEvent(new Event("click")); }
  getBoundingClientRect() { return { width: 900, height: 600 }; }
}

test("app.js accessibility: selection, text, keyboard, trace, scope and run identity", async () => {
  const elements = new Map<string, Element>();
  const document = {
    body: new Element("body"), activeElement: null,
    getElementById(id: string) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; },
    createElement: (tag: string) => new Element(tag),
    createElementNS: (_ns: string, tag: string) => new Element(tag),
    querySelectorAll: () => [],
  };
  await runInNewContext(app.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "") + "\n(async () => {" + replay + "})()", {
    ...pages, ...taskScope, ...navigation, ...executionData, ...viewState, ...workspace, createExecutionDetails, layoutGraph, document, Event,
    window: { addEventListener() {} }, ResizeObserver: class { observe() {} },
    fetch() { throw new Error("Unexpected network request"); },
  });
  assert.equal(document.body.getAttribute("data-replay"), "passed");
});

const chrome = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(p => p && existsSync(p));
test("local Chrome fixture QA: native DOM replay and trusted Space without scroll", { skip: !chrome, timeout: 30000 }, async () => {
  let resolveResult!: (value: string) => void;
  let rejectResult!: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const result = { promise, resolve: resolveResult, reject: rejectResult };
  const requests: string[] = [];
  let browserErrors = "";
  let browserFirstErrors = "";
  const diagnostics = () => `requests=${JSON.stringify(requests)}; Chrome stderr (first)=${browserFirstErrors}; (last)=${browserErrors}`;
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === "POST" && req.url === "/replay-result") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => { res.writeHead(204).end(); result.resolve(body); });
      return;
    }
    const name = req.url?.slice(1) || "index.html";
    if (!["index.html", "app.js", "style.css", "layout.js", "usage-pages.js", "task-scope.js", "navigation.js", "execution-data.js", "view-state.js", "workspace.js", "execution-details.js"].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader("Connection", "close");
    res.setHeader("Content-Type", name.endsWith("js") ? "text/javascript" : name.endsWith("css") ? "text/css" : "text/html");
    if (name === "index.html") {
      const html = readFileSync(new URL(name, root), "utf8");
      res.end(html.replace('<script type="module"', `<script>
        const reportFailure = message => fetch('/replay-result', { method: 'POST', body: 'Browser error: ' + message });
        window.addEventListener('error', event => reportFailure(event.message || event.target.src || 'resource load failed'), true);
        window.addEventListener('unhandledrejection', event => reportFailure(String(event.reason)));
      </script><script type="module"`));
      return;
    }
    res.end(name === "app.js" ? app + `\ntry { ${replay} } catch (error) { document.body.setAttribute('data-replay', String(error.stack)); }
window.harvestQA = () => {
  const graph = state.run.graphs[0]; state.graph = graph.id; state.node = null;
  graph.nodes = Array.from({length:20},(_,i)=>({...graph.nodes[0],id:'n'+i,activations:[]}));
  graph.entry='n0'; graph.edges=graph.nodes.slice(1).map((n,i)=>({from:'n'+i,to:n.id}));
  state.cameras.clear(); renderPanel();
  const nodes=Array.from(document.querySelectorAll('#graph [role="button"]'));
  nodes[10].focus({preventScroll:true});
  const node=nodes[10].getBoundingClientRect(), frame=$('graph').getBoundingClientRect();
  const visible=node.top>=frame.top&&node.bottom<=frame.bottom&&node.left>=frame.left&&node.right<=frame.right;
  if(!visible) throw new Error(JSON.stringify({node:node.toJSON(),frame:frame.toJSON(),camera}));
  renderPanel(); const kept=document.activeElement.dataset.nodeId==='n10';
  camera={x:0,y:0,width:50000,height:40000,viewportWidth:700}; zoom(1.25);
  const outward=camera.width; zoom(0.8); const inward=camera.width;
  const retainedViewport=camera.viewportWidth===700;
  // Полное имя доступно, но видимые строки не выходят за карточку.
  graph.nodes=[{...graph.nodes[0],id:'Ш'.repeat(30)}];graph.entry=graph.nodes[0].id;graph.edges=[];
  renderPanel();const group=document.querySelector('#graph [role="button"]');
  const width=Number(group.querySelector('rect').getAttribute('width'));
  const textFits=Array.from(group.querySelectorAll('text')).every(t=>t.getComputedTextLength()<=width-32);
  return {visible,kept,outward,inward,retainedViewport,textFits,fullName:group.getAttribute('aria-label').includes('Ш'.repeat(30))};
};
window.checkOutlineQA = async () => {
  const graph=state.run.graphs[0]; state.graph=graph.id; state.scope='';state.node=graph.nodes[0].id;state.key=null;state.tab='graph';
  graph.nodes[0].activations=[{key:'native-outline',scope:'["graph","main"]',path:'main / node',visit:1,attempt:1,status:'succeeded',startedAt:1,finishedAt:2,findings:[]}];
  renderPanel();
  const old=document.querySelectorAll('#outline .outline-node .outline-link')[1];
  old.focus({preventScroll:true});
  graph.nodes[0].label='Updated label'; renderPanel();
  const next=document.querySelectorAll('#outline .outline-node .outline-link')[1];
  const immediate=document.activeElement===next;
  await new Promise(resolve=>setTimeout(resolve,100)); // Native toggle event queued by restoring details.open.
  const afterToggle=document.activeElement===next, connected=next.isConnected, open=next.closest('details').open;
  const schema=document.querySelectorAll('#outline .outline-node .outline-link')[0];schema.focus({preventScroll:true});
  graph.nodes[0].label='Another label';renderPanel();
  const schemaFocused=document.activeElement===document.querySelectorAll('#outline .outline-node .outline-link')[0];
  return {immediate,afterToggle,connected,open,schemaFocused};
};
window.checkTraceQA = async () => {
  state.tab='trace';state.run.trace={supported:true,count:2,failed:0,lastSeq:2};
  const record={seq:1,key:'route0',attempt:1,at:1,context:{graphId:state.graph,scope:[],visit:0},
    decision:{from:'route',to:'end',reason:'condition',evaluations:[{edgeIndex:0,to:'end',result:'true'}]}};
  const page=tracePages.get(state.id);
  Object.assign(page,{opened:true,reports:[record],cursor:1,hasMore:true,error:null,loading:false});
  renderPanel();
  const details=document.querySelector('#content-panel .transition-details details');
  details.open=true;details.querySelector('summary').focus({preventScroll:true});
  const savedFetch=globalThis.fetch;
  let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
  try {
    Array.from(document.querySelectorAll('#content-panel button')).find(b=>b.textContent.includes('Загрузить следующие переходы')).click();
    for(let i=0;i<5&&typeof finish!=='function';i++) await Promise.resolve();
    finish({ok:true,status:200,json:async()=>({records:[{...record,seq:2}],nextAfter:2,hasMore:false})});
    await new Promise(resolve=>setTimeout(resolve,100));
    const updated=document.querySelector('#content-panel .transition-details details');
    return {open:updated.open,focused:document.activeElement===updated.querySelector('summary'),loaded:page.reports.length===2};
  } finally {globalThis.fetch=savedFetch;}
};
window.checkBreadcrumbQA = async () => {
  const main=state.run.graphs[0], parent=main.nodes[0];
  parent.kind='subworkflow'; parent.children=[{id:'child',graphId:'child'}];
  parent.activations=[{key:'native-parent',scope:'["graph","main"]',path:'main / parent',visit:1,attempt:1,status:'succeeded',startedAt:1,finishedAt:2,findings:[]}];
  const scope=JSON.stringify(['graph','main','node',parent.id,'visit','0','graph','child']);
  state.run.graphs.push({id:'child',entry:'nested',edges:[],nodes:[{...parent,id:'nested',children:[],activations:[{...parent.activations[0],key:'native-child',scope}]}]});
  state.graph='child';state.scope=scope;state.node=null;state.key=null;state.tab='graph';renderPanel();
  const before=document.querySelectorAll('#breadcrumbs .crumb')[1];before.focus({preventScroll:true});
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({...state.run,usage:{...state.run.usage,totalTokens:25}})});
  try { await refreshSnapshot(); } finally { globalThis.fetch=oldFetch; }
  const after=document.querySelectorAll('#breadcrumbs .crumb')[1];
  return {changed:before!==after,focused:document.activeElement===after,key:before.dataset.uiKey===after.dataset.uiKey};
};
window.checkAutoTraceQA = async () => {
  const page=tracePages.get(state.id), oldFetch=globalThis.fetch;
  state.tab='trace';state.run.trace={supported:true,count:2,failed:0,lastSeq:2};
  Object.assign(page,{opened:true,cursor:2,hasMore:false,loading:false,error:null});renderPanel();
  const panel=$('content-panel');panel.style.height='70px';panel.style.overflow='auto';
  const detail=panel.querySelector('.transition-details details');detail.open=true;detail.querySelector('summary').focus({preventScroll:true});
  panel.scrollTop=25;const beforeScroll=panel.scrollTop;
  let finish;
  globalThis.fetch=path=>path.startsWith('snapshot?')
    ? Promise.resolve({ok:true,status:200,json:async()=>({...state.run,trace:{...state.run.trace,count:3,lastSeq:3}})})
    : new Promise(resolve=>{finish=resolve});
  try {
    await refreshSnapshot();
    const during=panel.querySelector('.transition-details details');
    const immediate=during.open&&document.activeElement===during.querySelector('summary')&&panel.scrollTop===beforeScroll;
    for(let i=0;i<5&&typeof finish!=='function';i++)await Promise.resolve();
    finish({ok:true,status:200,json:async()=>({records:[{...page.reports[0],seq:3}],nextAfter:3,hasMore:false})});
    await new Promise(resolve=>setTimeout(resolve,100));
    const after=panel.querySelector('.transition-details details');
    return {immediate,open:after.open,focused:document.activeElement===after.querySelector('summary'),scrolled:beforeScroll>0&&panel.scrollTop===beforeScroll,loaded:page.reports.length===3};
  } finally {globalThis.fetch=oldFetch;panel.style.height='';panel.style.overflow='';}
};
window.checkArchiveQA = async () => {
  const graph=state.run.graphs[0], node=graph.nodes[0], activation=node.activations[0];
  state.graph=graph.id;state.scope=activation.scope;state.node=node.id;
  state.key=activation.key;state.attempt=1;state.tab='graph';
  const identity=JSON.stringify([state.id,activation.key]);
  Object.assign(attemptPages.get(identity),{opened:true,reports:[],cursor:0,hasMore:false});
  attemptPages.snapshots.set(identity,{current:{attempt:1,status:'running',startedAt:1,finishedAt:null,metadata:{},output:{value:'STALE_CURRENT'}},missingArchived:0});
  renderPanel();
  const inspector=$('inspector');inspector.style.height='90px';inspector.style.overflow='auto';
  const before=inspector.querySelector('.node-definition');before.open=true;
  before.querySelector('summary').focus({preventScroll:true});
  inspector.scrollTop=25;const scroll=inspector.scrollTop;
  const originalFetch=globalThis.fetch;let finish;
  const newer={...state.run,graphs:state.run.graphs.map(g=>({...g,nodes:g.nodes.map(n=>({...n,
    activations:n.activations.map(a=>a.key===activation.key?{...a,attempt:2}:a)}))}))};
  globalThis.fetch=path=>path.startsWith('snapshot?')
    ? Promise.resolve({ok:true,status:200,json:async()=>newer})
    : path.startsWith('attempts?') ? new Promise(resolve=>{finish=resolve;}) : Promise.reject(Error(path));
  const read=()=>({rows:inspector.querySelectorAll(':scope > .detail-run').length,
    open:inspector.querySelector('.node-definition').open,
    focused:document.activeElement===inspector.querySelector('.node-definition summary'),
    scroll:scroll>0&&inspector.scrollTop===scroll,
    stale:inspector.textContent.includes('STALE_CURRENT')});
  try {
    await refreshSnapshot();const pending=read();
    finish({ok:true,status:200,json:async()=>({records:[{attempt:1,status:'failed',startedAt:1,finishedAt:2,metadata:{},error:'ARCHIVED'}],
      current:{attempt:2,status:'succeeded',startedAt:2,finishedAt:3,metadata:{}},nextAfter:1,hasMore:false,missingArchived:0})});
    await new Promise(resolve=>setTimeout(resolve,100));
    return {pending,finished:read(),archived:inspector.textContent.includes('ARCHIVED')};
  } finally {globalThis.fetch=originalFetch;inspector.style.height='';inspector.style.overflow='';}
};
window.prepareInspectorCloseQA = () => {
  state.tab='history';state.node=state.run.graphs.find(g=>g.id===state.graph).nodes[0].id;
  state.key=null;state.attempt=null;renderPanel();
  const close=document.querySelector('#inspector .inspector-close');close.focus({preventScroll:true});
  return {focused:document.activeElement===close,shown:!$('inspector').hidden,graphHidden:$('graph-panel').hidden};
};
window.checkInspectorCloseQA = () => ({closed:$('inspector').hidden,tab:state.tab,
  focused:document.activeElement===$('search'),visible:!$('search').closest('[hidden]')});
window.prepareHistoryFilterQA = () => {
  state.tab='history';state.filter='all';state.node=null;state.key=null;renderPanel();
  const panel=$('content-panel');panel.style.flex='0 0 70px';panel.style.height='70px';panel.style.overflow='auto';
  const filter=panel.querySelector('select[aria-label="Фильтр истории"]');
  filter.focus({preventScroll:true});panel.scrollTop=15;
  window.filterBefore=filter;window.filterScroll=panel.scrollTop;window.filterTrusted=null;window.filterKeys=[];
  filter.addEventListener('keydown',event=>{window.filterKeys.push([event.key,event.isTrusted]);});
  filter.addEventListener('change',event=>{window.filterTrusted=event.isTrusted;});
  return {focused:document.activeElement===filter,scroll:window.filterScroll>0};
};
window.checkHistoryFilterQA = () => {
  const panel=$('content-panel'), filter=panel.querySelector('select[aria-label="Фильтр истории"]');
  const result={trustedKey:window.filterKeys.some(([key,trusted])=>key==='ArrowDown'&&trusted),
    changeDelivered:window.filterTrusted===false,changed:filter!==window.filterBefore,focused:document.activeElement===filter,
    selected:filter.value,scroll:panel.scrollTop===window.filterScroll,oldRemoved:!window.filterBefore.isConnected};
  panel.style.flex='';panel.style.height='';panel.style.overflow='';return result;
};
window.prepareWaitQA = () => {
  state.run = {...state.run,status:'paused',desired:'paused',waits:[{id:'native-wait',key:'native-key',status:'open',reason:'Ответ',input:{},responseSchema:{type:'object'}}]};
  state.tab='now';state.node=null;renderPanel();
  const field=$('wait-response-native-wait');field.style.height='80px';field.focus();
  window.waitTrusted=false;field.addEventListener('input',event=>{window.waitTrusted=event.isTrusted;});
};
window.checkWaitQA = () => {
  const field=$('wait-response-native-wait'),details=document.querySelector('details[data-wait-details]');
  details.open=true;field.setSelectionRange(2,9,'backward');field.scrollTop=120;
  const before={value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,scroll:field.scrollTop};
  state.run.updatedAt++;renderPanel();
  const next=$('wait-response-native-wait');
  const after={value:next.value,start:next.selectionStart,end:next.selectionEnd,direction:next.selectionDirection,scroll:next.scrollTop};
  const kept=document.activeElement===next&&JSON.stringify(before)===JSON.stringify(after)&&document.querySelector('details[data-wait-details]').open;
  const submit=$('wait-submit-native-wait');submit.focus();renderPanel();
  return {trusted:window.waitTrusted,kept,scrolled:before.scroll>0,submitKept:document.activeElement===$('wait-submit-native-wait')};
};
window.prepareCanvasQA = (count = 2) => {
  document.body.style.removeProperty('height');document.body.style.removeProperty('overflow');
  document.documentElement.style.removeProperty('overflow');window.scrollTo(0,0);
  const graph=state.run.graphs[0];state.graph=graph.id;state.scope='';state.node=null;state.key=null;state.attempt=null;state.tab='graph';
  state.run={...state.run,name:'Вертикальный процесс',status:'succeeded',failure:null,waits:[],activeKeys:[]};
  graph.nodes=Array.from({length:count},(_,i)=>({id:'vertical-'+i,label:'Этап '+(i+1),kind:'check',status:'succeeded',children:[],activations:[]}));
  graph.entry=graph.nodes[0].id;graph.edges=graph.nodes.slice(1).map((n,i)=>({from:graph.nodes[i].id,to:n.id}));
  $('run-details').open=false;$('activity-strip').open=false;setGraphExpanded(false);state.cameras.clear();renderHeader();renderPanel();
};
window.measureCanvasQA = () => {
  const frame=$('graph').getBoundingClientRect(), main=document.querySelector('main');
  const nodes=Array.from(document.querySelectorAll('#graph .graph-node'));
  return {height:frame.height,bottom:frame.bottom,width:frame.width,
    pageOverflow:main.scrollHeight-main.clientHeight,
    scale:nodes[0].getScreenCTM().a,
    visible:nodes.every(n=>{const box=n.getBoundingClientRect();return box.top>=frame.top&&box.bottom<=frame.bottom&&box.left>=frame.left&&box.right<=frame.right;}),
    drawerOpen:$('activity-strip').open,expanded:document.body.dataset.graphExpanded==='true'};
};
window.canvasActionQA = action => {
  if(action==='drawer') { $('activity-strip').querySelector('summary').click();return $('activity-strip').open; }
  if(action==='poll') { renderPanel();return; }
  if(action==='pan-and-poll') {
    $('actual-size').click();$('graph').focus();$('graph').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    window.cameraBeforePoll=$('graph').getAttribute('viewBox');renderPanel();return;
  }
  $(action).click();
};
await fetch('/replay-result', { method: 'POST', body: document.body.getAttribute('data-replay') });` : readFileSync(new URL(name, root)));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = mkdtempSync(join(tmpdir(), "node-a11y-chrome-"));
  const browserHome = join(profile, "home");
  mkdirSync(browserHome);
  let browser: ReturnType<typeof spawn> | undefined;
  const deadline = setTimeout(() => result.reject(new Error(`Chrome replay did not report within 20s; ${diagnostics()}`)), 20000);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    // Do not wait for --dump-dom's process/stdio shutdown: Chrome helper processes
    // can retain those pipes after the page has finished. Stderr is drained for
    // diagnostics and explicitly destroyed in cleanup. The page reports actual
    // assertion success/failure over loopback instead, with a bounded deadline.
    // Fresh HOME reproduces first-run CI startup. Automation flags prevent
    // native keychain/default-browser prompts from blocking before HTTP navigation.
    browser = spawn(chrome!, [
      "--headless", "--remote-debugging-port=0", "--no-sandbox", "--enable-automation", "--no-default-browser-check",
      "--disable-component-update", "--disable-default-apps", "--no-service-autorun",
      "--password-store=basic", "--use-mock-keychain", "--disable-gpu",
      "--disable-background-networking", "--no-proxy-server",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--no-first-run",
      `--user-data-dir=${profile}`, `http://127.0.0.1:${address.port}/`,
    ], {
      env: { ...process.env, HOME: browserHome },
      stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32",
    });
    browser.stderr?.setEncoding("utf8");
    browser.stderr?.on("data", chunk => { browserFirstErrors = (browserFirstErrors + chunk).slice(0, 4096); browserErrors = (browserErrors + chunk).slice(-4096); });
    browser.once("error", error => result.reject(error));
    browser.once("exit", (code, signal) => result.reject(new Error(`Chrome exited before reporting: ${code}/${signal}; ${diagnostics()}`)));
    assert.equal(await result.promise, "passed");
    // CDP Input generates trusted browser input; synthetic dispatch alone cannot
    // establish that Space's scrolling default action was suppressed.
    const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(browserFirstErrors)?.[1];
    assert.ok(endpoint, "isolated Chrome must expose its debugging endpoint");
    const targets = await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    const page = targets.find(target => target.type === "page");
    assert.ok(page);
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("CDP connection failed")); });
    let sequence = 0;
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        socket.removeEventListener("message", listener);
        reject(new Error(`Chrome did not answer ${method}: ${JSON.stringify(params)}`));
      }, 5000);
      const listener = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        clearTimeout(timeout);
        socket.removeEventListener("message", listener);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method, params }));
    });
    try {
      const setup = await send("Runtime.evaluate", { expression: `
        document.body.style.height = '6000px';
        document.documentElement.style.overflow = 'auto';
        document.body.style.overflow = 'visible';
        window.scrollTo(0, 200);
        document.querySelectorAll('#graph [role="button"]')[0].focus({preventScroll:true});
        window.spaceScroll = window.scrollY;
        window.spaceTrusted = false;
        document.activeElement.addEventListener('keydown', e => { window.spaceTrusted = e.isTrusted; });
        document.activeElement.getAttribute('role');`, returnByValue: true });
      assert.equal(setup.result.value, "button");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
      const observation = await send("Runtime.evaluate", { expression: `new Promise(resolve => setTimeout(() => resolve({
        trusted: window.spaceTrusted, before: window.spaceScroll, after: window.scrollY,
        pressed: document.querySelector('#graph [role="button"]').getAttribute('aria-pressed'), focused: document.activeElement === document.querySelector('#graph [role="button"]')
      }), 250))`, awaitPromise: true, returnByValue: true });
      assert.equal(observation.result.value.trusted, true);
      assert.ok(observation.result.value.before > 0, "fixture must be scrollable");
      assert.equal(observation.result.value.after, observation.result.value.before);
      assert.equal(observation.result.value.pressed, "true");
      assert.equal(observation.result.value.focused, true);
      const harvest = await send("Runtime.evaluate", { expression: "window.harvestQA()", returnByValue: true });
      assert.ok(!harvest.exceptionDetails,JSON.stringify(harvest.exceptionDetails));
      assert.deepEqual(harvest.result.value, {visible:true,kept:true,outward:62500,inward:50000,retainedViewport:true,textFits:true,fullName:true});
      const outlineQA=await send("Runtime.evaluate",{expression:"window.checkOutlineQA()",awaitPromise:true,returnByValue:true});
      assert.deepEqual(outlineQA.result.value,{immediate:true,afterToggle:true,connected:true,open:true,schemaFocused:true});
      const traceQA=await send("Runtime.evaluate",{expression:"window.checkTraceQA()",awaitPromise:true,returnByValue:true});
      assert.ok(!traceQA.exceptionDetails, JSON.stringify(traceQA.exceptionDetails));
      assert.deepEqual(traceQA.result.value,{open:true,focused:true,loaded:true});
      const breadcrumbQA=await send("Runtime.evaluate",{expression:"window.checkBreadcrumbQA()",awaitPromise:true,returnByValue:true});
      assert.ok(!breadcrumbQA.exceptionDetails, JSON.stringify(breadcrumbQA.exceptionDetails));
      assert.deepEqual(breadcrumbQA.result.value,{changed:true,focused:true,key:true});
      const autoTraceQA=await send("Runtime.evaluate",{expression:"window.checkAutoTraceQA()",awaitPromise:true,returnByValue:true});
      assert.ok(!autoTraceQA.exceptionDetails, JSON.stringify(autoTraceQA.exceptionDetails));
      assert.deepEqual(autoTraceQA.result.value,{immediate:true,open:true,focused:true,scrolled:true,loaded:true});
      const archiveQA=await send("Runtime.evaluate",{expression:"window.checkArchiveQA()",awaitPromise:true,returnByValue:true});
      assert.ok(!archiveQA.exceptionDetails, JSON.stringify(archiveQA.exceptionDetails));
      assert.deepEqual(archiveQA.result.value,{pending:{rows:1,open:true,focused:true,scroll:true,stale:false},finished:{rows:1,open:true,focused:true,scroll:true,stale:false},archived:true});
      const preparedClose=await send("Runtime.evaluate",{expression:"window.prepareInspectorCloseQA()",returnByValue:true});
      assert.deepEqual(preparedClose.result.value,{focused:true,shown:true,graphHidden:true});
      await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",text:"\r",unmodifiedText:"\r",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
      await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
      const closeQA=await send("Runtime.evaluate",{expression:"window.checkInspectorCloseQA()",returnByValue:true});
      assert.deepEqual(closeQA.result.value,{closed:true,tab:'history',focused:true,visible:true});
      await send("Runtime.evaluate",{expression:"window.prepareWaitQA()"});
      await send("Input.insertText",{text:JSON.stringify({answer:Array.from({length:50},(_,i)=>'строка '+i)},null,2)});
      const waitQA=await send("Runtime.evaluate",{expression:"window.checkWaitQA()",returnByValue:true});
      assert.deepEqual(waitQA.result.value,{trusted:true,kept:true,scrolled:true,submitKept:true});
      const filterReady=await send("Runtime.evaluate",{expression:"window.prepareHistoryFilterQA()",returnByValue:true});
      assert.deepEqual(filterReady.result.value,{focused:true,scroll:true});
      await send("Input.dispatchKeyEvent",{type:"keyDown",key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40,nativeVirtualKeyCode:40});
      await send("Input.dispatchKeyEvent",{type:"keyUp",key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40,nativeVirtualKeyCode:40});
      // Headless Chrome delivers trusted keys but does not commit native select
      // popups through CDP. Dispatch change on the focused real DOM element.
      await send("Runtime.evaluate",{expression:`(() => {
        window.filterBefore.value='issues';window.filterBefore.dispatchEvent(new Event('change',{bubbles:true}));
      })()`});
      const filterQA=await send("Runtime.evaluate",{expression:"window.checkHistoryFilterQA()",returnByValue:true});
      assert.deepEqual(filterQA.result.value,{trustedKey:true,changeDelivered:true,changed:true,focused:true,selected:'issues',scroll:true,oldRemoved:true});
      // Real geometry, not CSS string checks: the default vertical graph gets at
      // least half the viewport, both short-chain nodes are readable and visible.
      const measureCanvas = async () => {
        // Headless/background Chrome may suspend animation frames after emulation.
        const result=await send('Runtime.evaluate',{expression:'new Promise(resolve=>setTimeout(()=>resolve(window.measureCanvasQA()),80))',awaitPromise:true,returnByValue:true});
        assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
      };
      for (const [width,height] of [[1440,900],[1280,800],[1512,679]] as const) {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await send('Runtime.evaluate',{expression:'window.prepareCanvasQA()'});
        const normal=await measureCanvas();
        assert.ok(normal.height>=height*.5,JSON.stringify(normal));
        assert.ok(normal.bottom<=height,JSON.stringify(normal));
        assert.ok(normal.pageOverflow<=2,JSON.stringify(normal));
        assert.ok(normal.scale>=.99 && normal.scale<=1.01,JSON.stringify(normal));
        assert.equal(normal.visible,true);assert.equal(normal.drawerOpen,false);
        const opened=await send('Runtime.evaluate',{expression:`window.canvasActionQA('drawer')`,returnByValue:true});assert.equal(opened.result.value,true);
        await send('Runtime.evaluate',{expression:`window.canvasActionQA('poll')`});
        const drawer=await measureCanvas();assert.equal(drawer.drawerOpen,true,JSON.stringify(drawer));assert.equal(drawer.height,normal.height);
        await send('Runtime.evaluate',{expression:`window.canvasActionQA('drawer');window.canvasActionQA('expand-graph')`});
        const expanded=await measureCanvas();assert.equal(expanded.expanded,true);
        assert.ok(expanded.height>=height*.75,JSON.stringify(expanded));assert.equal(expanded.scale,normal.scale);
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
        const restored=await measureCanvas();assert.equal(restored.expanded,false);assert.equal(restored.height,normal.height);
        const focus=await send('Runtime.evaluate',{expression:`document.activeElement===document.getElementById('expand-graph')`,returnByValue:true});assert.equal(focus.result.value,true);
      }
      await send('Runtime.evaluate',{expression:`window.prepareCanvasQA(12);window.canvasActionQA('fit')`});
      const fitted=await measureCanvas();assert.equal(fitted.visible,true);assert.ok(fitted.scale<.5);
      await send('Runtime.evaluate',{expression:`window.canvasActionQA('expand-graph')`});
      const refitted=await measureCanvas();assert.equal(refitted.visible,true);assert.ok(refitted.scale>fitted.scale);
      await send('Runtime.evaluate',{expression:`window.canvasActionQA('pan-and-poll')`});
      const read=await measureCanvas();assert.equal(read.scale,1);
      const keptCamera=await send('Runtime.evaluate',{expression:`window.cameraBeforePoll===document.getElementById('graph').getAttribute('viewBox')`,returnByValue:true});assert.equal(keptCamera.result.value,true);
      await send('Runtime.evaluate',{expression:`window.canvasActionQA('expand-graph')`});
      // Real CSS cascade at mobile/zoom widths. A stacked sidebar must not trap main
      // below a 100dvh body with scrolling disabled (notably 651–700px).
      for (const width of [650, 680, 700, 701]) {
        await send("Emulation.setDeviceMetricsOverride",{width,height:800,deviceScaleFactor:1,mobile:false});
        const responsive=await send("Runtime.evaluate",{expression:`(() => {
          document.body.style.removeProperty('height');document.body.style.removeProperty('overflow');
          document.documentElement.style.removeProperty('overflow');window.scrollTo(0,0);
          const side=document.querySelector('.sidebar').getBoundingClientRect();
          const main=document.querySelector('main').getBoundingClientRect();
          const display=getComputedStyle(document.body).display;
          window.scrollTo(0,10000);
          return {width:innerWidth,display,sidebarHeight:side.height,mainTop:main.top,mainWidth:main.width,
            canPageScroll:window.scrollY>0};
        })()`,returnByValue:true});
        assert.ok(!responsive.exceptionDetails,JSON.stringify(responsive.exceptionDetails));
        const value=responsive.result.value;
        assert.equal(value.width,width);assert.ok(value.mainWidth>0,JSON.stringify(value));
        if(width<=700){
          assert.equal(value.display,'block',JSON.stringify(value));
          assert.ok(value.sidebarHeight<800,JSON.stringify(value));
          assert.ok(value.mainTop<800,JSON.stringify(value));
          assert.equal(value.canPageScroll,true,JSON.stringify(value));
        }else assert.equal(value.display,'grid',JSON.stringify(value));
      }
      await send("Emulation.clearDeviceMetricsOverride");
    } finally { socket.close(); }
  } finally {
    clearTimeout(deadline);
    // Only terminate the isolated browser process group created by this test.
    if (browser?.pid) {
      try {
        if (process.platform !== "win32") process.kill(-browser.pid, "SIGKILL");
        else browser.kill("SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      browser.stderr?.destroy();
      browser.unref();
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
