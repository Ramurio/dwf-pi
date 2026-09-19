import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { executePiWorker } from "../src/pi-worker.js";
import { ExecutionFailure } from "../src/execution-failure.js";
import type { PiWorkerResult } from "../src/execution-types.js";
import { fixtureRequest, fixtureRuntime } from "./fixtures/session-pool-lifecycle.js";

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await check()) return; await delay(20); }
  throw new Error("Fixture barrier timed out");
}
async function readPid(cwd: string): Promise<number | undefined> {
  try {
    const pid = Number(await readFile(join(cwd, "pid"), "utf8"));
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return !execFileSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().startsWith("Z");
  } catch { return false; }
}
function killOwned(pid: number) {
  try { process.kill(pid, "SIGKILL"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

test("abort during real bash kills only that session's command and the peer completes once", { skip: process.platform === "win32", timeout: 25_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "dynamicwf-pool-abort-"));
  const { runtime, calls } = await fixtureRuntime(root);
  const [cancel, peer] = await Promise.all([fixtureRequest(root, "cancel"), fixtureRequest(root, "peer")]);
  const abort = new AbortController(), peerAbort = new AbortController();
  const cancelled = executePiWorker(cancel!, { modelRuntime: runtime, signal: abort.signal }).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  const pendingPeer = executePiWorker(peer!, { modelRuntime: runtime, signal: peerAbort.signal });
  void pendingPeer.catch(() => {});
  let cancelPid: number | undefined, peerPid: number | undefined;
  try {
    await until(async () => { cancelPid = await readPid(cancel!.cwd); peerPid = await readPid(peer!.cwd); return !!cancelPid && !!peerPid; });
    assert.ok(alive(cancelPid!) && alive(peerPid!));
    abort.abort();
    const result = await cancelled;
    assert.ok(result.error instanceof ExecutionFailure);
    assert.equal(result.error.failure.code, "cancelled");
    assert.equal(result.error.failure.effects, "unknown");
    await until(() => !alive(cancelPid!));
    assert.ok(alive(peerPid!), "Aborting one session killed its peer's command");
    assert.equal(calls.get("cancel"), 1);
    await assert.rejects(readFile(join(cancel!.cwd, "finished")), { code: "ENOENT" });
    await writeFile(join(peer!.cwd, "release"), "release");
    const completed = await pendingPeer;
    assert.deepEqual(completed.output, { worker: "peer" });
    assert.equal(completed.usage?.totalTokens, 4);
    assert.equal(calls.get("peer"), 2);
    for (const request of [cancel!, peer!]) assert.equal(await readFile(join(request.cwd, "effect.txt"), "utf8"), "once\n");
    assert.equal(await readFile(join(peer!.cwd, "finished"), "utf8"), "peer");
    assert.ok(!(await readFile(completed.sessionFile, "utf8")).includes("POOL_LIFECYCLE_cancel"));
  } finally {
    abort.abort(); peerAbort.abort();
    for (const request of [cancel!, peer!]) { const pid = await readPid(request.cwd); if (pid && alive(pid)) killOwned(pid); }
    await Promise.allSettled([cancelled, pendingPeer]);
    await rm(root, { recursive: true, force: true });
  }
});

test("SIGKILL of a shared SDK process loses pending results and leaves detached bash effects alive", { skip: process.platform === "win32", timeout: 25_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "dynamicwf-pool-crash-"));
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/session-pool-lifecycle.ts", import.meta.url)), root], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const results: PiWorkerResult[] = [];
  let stderr = "", spawnError: Error | undefined;
  assert.ok(child.stderr);
  child.stderr.on("data", data => { stderr = (stderr + String(data)).slice(-8000); });
  child.on("error", error => { spawnError = error; });
  child.on("message", (message: { type?: string; result?: PiWorkerResult }) => { if (message.type === "result" && message.result) results.push(message.result); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => child.once("close", (code, signal) => resolveExit({ code, signal })));
  let a: number | undefined, b: number | undefined;
  try {
    await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Fixture exited: ${stderr}`);
      a = await readPid(join(root, "a")); b = await readPid(join(root, "b"));
      return !!a && !!b && results.length === 1;
    });
    assert.deepEqual(results[0]!.output, { worker: "saved" });
    // Parent-owned evidence, deliberately not a simulated RunStore checkpoint.
    await writeFile(join(root, "acknowledged.json"), JSON.stringify(results[0]));
    child.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    assert.ok(alive(a!) && alive(b!), "Detached command lifetime differs; revisit crash policy");
    assert.equal(results.length, 1);
    assert.deepEqual(JSON.parse(await readFile(join(root, "acknowledged.json"), "utf8")).output, { worker: "saved" });
    // Demonstrate an effect AFTER pool death, rather than inferring it from PID presence.
    await writeFile(join(root, "a", "release"), "release");
    await until(async () => { try { return await readFile(join(root, "a", "finished"), "utf8") === "a"; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } });
    assert.equal(results.length, 1, "A dead pool cannot acknowledge its orphan's result");
    assert.ok(alive(b!));
    for (const worker of ["saved", "a", "b"]) assert.equal(await readFile(join(root, worker, "effect.txt"), "utf8"), "once\n");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    for (const worker of ["saved", "a", "b"]) { const pid = await readPid(join(root, worker)); if (pid && alive(pid)) { killOwned(pid); await until(() => !alive(pid)); } }
    await rm(root, { recursive: true, force: true });
  }
});
