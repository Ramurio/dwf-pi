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
const records = scopes.map((scope, i) => ({ context: { graphId: 'main', scope, visit: 0 }, attempt: 1, at: 0,
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
  check(g.getAttribute('aria-label') === n.role + ': ' + n.id + ', В работе', 'full aria label');
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
    ...pages, ...taskScope, layoutGraph, document, Event,
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
    if (!["index.html", "app.js", "style.css", "layout.js", "usage-pages.js", "task-scope.js"].includes(name)) { res.writeHead(404).end(); return; }
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
      const listener = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
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
        pressed: document.querySelector('#graph [role="button"]').getAttribute('aria-pressed')
      }), 250))`, awaitPromise: true, returnByValue: true });
      assert.equal(observation.result.value.trusted, true);
      assert.ok(observation.result.value.before > 0, "fixture must be scrollable");
      assert.equal(observation.result.value.after, observation.result.value.before);
      assert.equal(observation.result.value.pressed, "true");
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
