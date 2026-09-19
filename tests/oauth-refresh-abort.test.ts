import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { spawn } from "node:child_process";
import { InMemoryModelsStore, type OAuthCredential } from "@earendil-works/pi-ai";
import { loadSdkAuthStorage } from "../src/sdk-auth-storage.js";
import { preserveCredentialPersistence } from "../src/credential-persistence.js";
import { createWorkflowModelRuntime } from "../src/model-runtime.js";

const old: OAuthCredential = { type: "oauth", access: "FAKE_OLD_ACCESS", refresh: "FAKE_OLD_REFRESH", expires: 0 };
const fresh: OAuthCredential = { type: "oauth", access: "FAKE_NEW_ACCESS", refresh: "FAKE_NEW_REFRESH", expires: Date.now() + 3600000 };
function barrier() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

for (const memory of [false, true]) test(`runtime completed refresh survives abort (${memory ? "memory" : "file"})`, { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "oauth-abort-"));
  try {
    const authPath = join(dir, "auth.json");
    const AuthStorage = await loadSdkAuthStorage();
    const store = memory ? AuthStorage.inMemory() : AuthStorage.create(authPath);
    await store.modify("xai", async () => old);
    const runtime = await createWorkflowModelRuntime({ ...(memory ? { credentials: store } : { authPath }), modelsPath: null, modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
    const caller = new AbortController();
    let calls = 0;
    const provider = runtime.getProvider("xai")!;
    runtime.registerNativeProvider({ ...provider, auth: { oauth: {
      name: "fake", login: async () => old,
      refresh: async (_current, signal) => { calls++; caller.abort(); assert.equal(signal.aborted, true); return fresh; },
      toAuth: async c => ({ apiKey: c.access }),
    } } });
    await assert.rejects(runtime.getAuth("xai", { signal: caller.signal }), error => {
      assert.doesNotMatch(String(error), /FAKE_/); return true;
    });
    // SDK may reject its outer abort race before the locked persistence finishes.
    const deadline = Date.now() + 5000;
    while (true) {
      const current = memory ? await store.read("xai") : JSON.parse(await readFile(authPath, "utf8")).xai;
      if (current?.access === fresh.access) break;
      assert.ok(Date.now() < deadline, "persistence did not complete");
      await setImmediate();
    }
    assert.deepEqual(await store.read("xai"), fresh);
    assert.equal((await runtime.getAuth("xai"))?.auth.apiKey, fresh.access);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(await runtime.listCredentials()), /FAKE_/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const abortDuringRefresh of [false, true]) test(`runtime failed refresh preserves credentials (abort=${abortDuringRefresh})`, { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "oauth-failure-"));
  const entered = barrier();
  const finishRefresh = barrier();
  try {
    const authPath = join(dir, "auth.json");
    const store = (await loadSdkAuthStorage()).create(authPath);
    await store.modify("xai", async () => old);
    const before = await readFile(authPath, "utf8");
    const runtime = await createWorkflowModelRuntime({ authPath, modelsPath: null,
      modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
    const caller = new AbortController();
    let calls = 0;
    let refreshSignal: AbortSignal | undefined;
    runtime.registerNativeProvider({ ...runtime.getProvider("xai")!, auth: { oauth: {
      name: "fake", login: async () => old,
      refresh: async (_current, signal) => {
        calls++;
        refreshSignal = signal;
        entered.resolve();
        await finishRefresh.promise;
        throw new Error("fake refresh failed without replacement");
      },
      toAuth: async () => { throw new Error("failed refresh must not derive request auth"); },
    } } });
    const rejected = assert.rejects(runtime.getAuth("xai", { signal: caller.signal }), error => {
      assert.doesNotMatch(String(error), /FAKE_/);
      if (abortDuringRefresh) assert.equal(error, caller.signal.reason);
      else assert.match(String(error), /fake refresh failed without replacement/);
      return true;
    });
    await entered.promise;
    assert.equal(refreshSignal?.aborted, false);
    if (abortDuringRefresh) {
      caller.abort();
      assert.equal(refreshSignal?.aborted, true);
      // The outer SDK race rejects while refresh still owns the file lock.
      await rejected;
    }
    finishRefresh.resolve();
    await rejected;
    // Acquiring the same SDK file lock is a completion barrier, unlike a cached
    // read or the outer getAuth abort race. No second write is performed.
    await store.modify("xai", async current => {
      assert.deepEqual(current, old);
      return undefined;
    });
    assert.equal(calls, 1);
    assert.equal(await readFile(authPath, "utf8"), before);
    assert.deepEqual(await store.read("xai"), old);
  } finally {
    finishRefresh.resolve();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pre-abort, lock wait cancellation, and failed mutation do not write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oauth-lock-"));
  try {
    const store = preserveCredentialPersistence((await loadSdkAuthStorage()).create(join(dir, "auth.json")));
    await store.modify("xai", async () => old);
    const controller = new AbortController(); controller.abort();
    let calls = 0;
    await assert.rejects(store.modify("xai", async () => { calls++; return fresh; }, { signal: controller.signal }));
    const entered = barrier(); const release = barrier();
    const holding = store.modify("xai", async () => { entered.resolve(); await release.promise; return undefined; });
    await entered.promise;
    const waiting = new AbortController();
    const rejected = assert.rejects(store.modify("xai", async () => { calls++; return fresh; }, { signal: waiting.signal }));
    waiting.abort(); await rejected;
    release.resolve(); await holding;
    await assert.rejects(store.modify("xai", async () => { throw new Error("fake refresh failed"); }));
    assert.equal(calls, 0); assert.deepEqual(await store.read("xai"), old);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("two processes serialize a rotation under the original file lock", { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "oauth-process-"));
  try {
    const path = join(dir, "auth.json");
    const store = (await loadSdkAuthStorage()).create(path);
    await store.modify("xai", async () => old);
    const script = `
      import { loadSdkAuthStorage } from './src/sdk-auth-storage.ts';
      import { preserveCredentialPersistence } from './src/credential-persistence.ts';
      const store = preserveCredentialPersistence((await loadSdkAuthStorage()).create(${JSON.stringify(path)}));
      const controller = new AbortController();
      process.send('ready');
      await new Promise(r => process.once('message', r));
      process.send("attempting");
      let rotated = false;
      try { await store.modify('xai', async current => {
        if (current.expires > Date.now()) return undefined;
        rotated = true; process.send('locked');
        await new Promise(r => process.once('message', r));
        controller.abort(); return ${JSON.stringify(fresh)};
      }, {signal: controller.signal}); } catch(e) { if (!controller.signal.aborted) throw e; }
      const value = await store.read('xai');
      process.send({done: true, rotated, fresh: value.access === ${JSON.stringify(fresh.access)}});
      process.disconnect();
    `;
    const children = [0, 1].map(() => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] }));
    let output = "";
    let attempting = 0;
    let locked: (typeof children)[number] | undefined;
    const releaseWhenContending = () => { if (attempting === 2 && locked) locked.send("release"); };
    const ready = children.map(child => new Promise<void>(resolve => child.on("message", message => { if (message === "ready") resolve(); })));
    const results = children.map(child => new Promise<{ rotated: boolean; fresh: boolean }>((resolve, reject) => {
      child.stdout!.on("data", data => { output += data; }); child.stderr!.on("data", data => { output += data; });
      child.on("error", reject);
      child.on("message", message => {
        if (message === "attempting") { attempting++; releaseWhenContending(); }
        if (message === "locked") { locked = child; releaseWhenContending(); }
        if (typeof message === "object" && message && "done" in message) resolve(message as unknown as { rotated: boolean; fresh: boolean });
      });
    }));
    const exits = children.map(child => new Promise<void>((resolve, reject) => child.on("exit", code => code === 0 ? resolve() : reject(new Error("child failed")))));
    await Promise.all(ready); children.forEach(child => child.send("start"));
    const values = await Promise.all(results); await Promise.all(exits);
    assert.equal(values.filter(v => v.rotated).length, 1);
    assert.ok(values.every(v => v.fresh)); assert.doesNotMatch(output, /FAKE_/);
    assert.deepEqual(await store.read("xai"), fresh);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
