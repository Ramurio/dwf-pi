import assert from "node:assert/strict";
import test from "node:test";
import { createServer, get } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { dashboardAlive, dashboardLabel, dashboardPlist, dashboardUrl, readDashboardConfig, type DashboardConfig } from "../src/dashboard.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { RunStore } from "../src/run-store.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/dynamicwf.mjs", import.meta.url));
const navigation = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none" };
function document(url: string, headers = navigation) {
  return new Promise<{ status: number; cookie: string; body: string }>((resolve, reject) => {
    get(url, { headers }, response => {
      let body = "";
      response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, cookie: response.headers["set-cookie"]?.[0]?.split(";")[0] ?? "", body }));
    }).on("error", reject);
  });
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function stop(config: DashboardConfig | null) {
  if (!config || !await dashboardAlive(config)) return;
  await fetch(`${dashboardUrl(config)}__dynamicwf/stop`, { method: "POST", headers: { "X-Dynamicwf-Manager": config.key } });
  for (let i = 0; i < 100 && await dashboardAlive(config); i++) await delay(50);
  assert.equal(await dashboardAlive(config), false);
}

test("stable bookmark establishes a local session; foreign pages cannot read or control it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-dashboard-auth-"));
  const filename = join(directory, "state.sqlite");
  const store = new RunStore(filename);
  const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "bookmark", name: "Bookmark", revision: 1, entryGraph: "main", graphs: {
    main: { entry: "done", nodes: [{ id: "done", kind: "end", value: { op: "literal", value: null } }], edges: [] },
  } }, { cwd: directory, availableModels: [] });
  store.create({ id: "run-bookmark", plan, input: null, cwd: directory });
  let viewer = await startGraphServer(filename, undefined, 0, { stable: true, managerKey: "private-key", storeId: "store-identity" });
  try {
    const url = viewer.url;
    assert.equal(new URL(url).pathname, "/");
    assert.equal((await fetch(url)).status, 403); // Fetch cannot bootstrap a cookie.
    assert.equal((await fetch(url + "runs")).status, 401);
    const page = await document(url + "?run=run-bookmark");
    assert.equal(page.status, 200);
    assert.match(page.body, /<section id="workspace" hidden>/);
    assert.ok(page.cookie);
    assert.equal((await document(url, { ...navigation, "Sec-Fetch-Site": "cross-site" })).status, 200); // An ordinary link is safe.
    const headers = { Cookie: page.cookie };
    assert.equal((await fetch(url + "runs", { headers })).status, 200);
    assert.equal((await fetch(url + "app.js", { headers })).status, 200);
    for (const site of ["cross-site", "same-site"]) {
      assert.equal((await fetch(url + "runs", { headers: { ...headers, "Sec-Fetch-Site": site } })).status, 403);
    }
    assert.equal((await document(url, { ...navigation, "Sec-Fetch-Dest": "iframe" })).status, 403);
    const controlHeaders = { ...headers, Origin: new URL(url).origin, "Content-Type": "application/json", "X-Dynamicwf-View": "1" };
    const body = JSON.stringify({ id: "run-bookmark", command: "pause" });
    for (const invalid of [headers, { ...controlHeaders, Origin: "https://evil.example" }, { ...controlHeaders, "X-Dynamicwf-View": "" }])
      assert.equal((await fetch(url + "control", { method: "POST", headers: invalid, body })).status, 403);
    assert.equal(store.get("run-bookmark").status, "queued");
    assert.equal((await fetch(url + "control", { method: "POST", headers: controlHeaders, body })).status, 200);
    assert.equal(store.get("run-bookmark").status, "paused");
    assert.equal((await fetch(url + "__dynamicwf/identity", { headers })).status, 403);
    assert.equal((await fetch(url + "__dynamicwf/stop", { method: "POST", headers: { "X-Dynamicwf-Manager": "private-key", Origin: new URL(url).origin } })).status, 403);
    const identity = await (await fetch(url + "__dynamicwf/identity", { headers: { "X-Dynamicwf-Manager": "private-key" } })).json();
    assert.deepEqual(identity, { service: "dynamicwf-dashboard", version: 1, storeId: "store-identity" });
    const before = store.events("run-bookmark");
    await viewer.close();
    viewer = await startGraphServer(filename, undefined, Number(new URL(url).port), { stable: true });
    assert.equal(viewer.url, url);
    assert.equal((await fetch(url + "runs", { headers })).status, 401); // The old browser session expires.
    const reopened = await document(url + "?run=run-bookmark");
    assert.equal(reopened.status, 200);
    const snapshot = await (await fetch(url + "snapshot?id=run-bookmark", { headers: { Cookie: reopened.cookie } })).json();
    assert.equal(snapshot.id, "run-bookmark");
    assert.deepEqual(store.events("run-bookmark"), before); // Restarting the viewer does not control the workflow.
  } finally { await viewer.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("separate CLI invocations reuse one dashboard, persist settings, serialize startup and recover after stop", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-dashboard-manager-"));
  const state = join(directory, "config"), filename = join(directory, "state.sqlite"), port = await unusedPort();
  const env = { ...process.env, DYNAMICWF_UI_STATE_DIR: state };
  const run = (args: string[]) => exec(process.execPath, [cli, "ui", ...args], { env, timeout: 25_000 });
  try {
    const outputs = await Promise.all([run(["--store", filename, "--port", String(port)]), run(["--store", filename, "--port", String(port)])]);
    for (const { stdout } of outputs) assert.match(stdout, new RegExp(`http://127.0.0.1:${port}/`));
    const config = (await readDashboardConfig(state))!;
    assert.equal(config.port, port);
    assert.equal(await dashboardAlive(config), true);
    assert.equal((await stat(join(state, "config.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(state)).mode & 0o777, 0o700);
    const first = await document(dashboardUrl(config));
    const again = await run(["--run", "run-test"]);
    assert.ok(again.stdout.includes(dashboardUrl(config, "run-test")));
    assert.equal((await document(dashboardUrl(config))).cookie, first.cookie); // Same server session, no restart.
    await assert.rejects(run(["--store", join(directory, "other.sqlite")]), /already uses/);
    assert.deepEqual(await readDashboardConfig(state), config);
    await stop(config);
    await run([]); // Reopens the saved store and port.
    assert.deepEqual(await readDashboardConfig(state), config);
    assert.notEqual((await document(dashboardUrl(config))).cookie, first.cookie);
  } finally { await stop(await readDashboardConfig(state)); await rm(directory, { recursive: true, force: true }); }
});

test("a busy port fails clearly and never replaces the unrelated listener", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-dashboard-busy-"));
  const server = createServer((_request, response) => response.end("unrelated service"));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(exec(process.execPath, [cli, "ui", "--store", join(directory, "state.sqlite"), "--port", String(port)], {
      env: { ...process.env, DYNAMICWF_UI_STATE_DIR: join(directory, "config") }, timeout: 20_000,
    }), /port may be occupied/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "unrelated service");
    assert.match(await readFile(join(directory, "config", "server.log"), "utf8"), /EADDRINUSE/);
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
    await rm(directory, { recursive: true, force: true });
  }
});

test("macOS login plist carries the exact paths and isolates dashboard profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-dashboard-plist-"));
  try {
    assert.notEqual(dashboardLabel(directory), dashboardLabel(directory + "-other"));
    const plist = dashboardPlist(directory, "/test/node", "/project & sample/bin/dynamicwf.mjs", "/custom/bin:/usr/bin");
    if (process.platform === "darwin") {
      const filename = join(directory, "agent.plist");
      await writeFile(filename, plist);
      const { stdout } = await exec("/usr/bin/plutil", ["-convert", "json", "-o", "-", filename]);
      const parsed = JSON.parse(stdout);
      assert.deepEqual(parsed.ProgramArguments, ["/test/node", "/project & sample/bin/dynamicwf.mjs", "ui", "--serve"]);
      assert.equal(parsed.EnvironmentVariables.DYNAMICWF_UI_STATE_DIR, directory);
      assert.equal(parsed.Label, dashboardLabel(directory));
      assert.equal(parsed.RunAtLoad, true); assert.equal(parsed.KeepAlive, true);
    } else assert.match(plist, /project &amp; sample/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
