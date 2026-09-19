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
const app = readFileSync(new URL("app.js", root), "utf8").split("await refreshRuns();\nlet tick = 0;")[0]!;
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
const selected = expected => {
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
  listeners = new Map<string, (() => void)[]>();
  constructor(public tagName = "div") {}
  set textContent(value: string) { this.ownText = String(value); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(n => n.textContent).join(""); }
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.ownText = ""; this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = String(value); if (key === "class") this.className = String(value); }
  getAttribute(key: string) { return key === "class" ? this.className : this.attributes[key]; }
  addEventListener(name: string, fn: () => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  dispatchEvent(event: { type: string }) { for (const fn of this.listeners.get(event.type) ?? []) fn(); }
  click() { this.dispatchEvent({ type: "click" }); }
  getBoundingClientRect() { return { width: 900, height: 600 }; }
}

test("app.js DOM replay: trace → scope, graph, all branches, node and redraw", () => {
  const elements = new Map<string, Element>();
  const document = {
    body: new Element("body"), activeElement: null,
    getElementById(id: string) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; },
    createElement: (tag: string) => new Element(tag),
    createElementNS: (_ns: string, tag: string) => new Element(tag),
    querySelectorAll: () => [],
  };
  runInNewContext(app.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "") + replay, {
    ...pages, ...taskScope, layoutGraph, document, Event,
    window: { addEventListener() {} }, ResizeObserver: class { observe() {} },
    fetch() { throw new Error("Unexpected network request"); },
  });
  assert.equal(document.body.getAttribute("data-replay"), "passed");
});

const chrome = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(p => p && existsSync(p));
test("local Chrome fixture QA: native dropdown events and SVG/inspector rendering", { skip: !chrome, timeout: 30000 }, async () => {
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
  const profile = mkdtempSync(join(tmpdir(), "q10-chrome-"));
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
      "--headless", "--no-sandbox", "--enable-automation", "--no-default-browser-check",
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
