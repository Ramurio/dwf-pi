import { executionFailure, ExecutionFailure } from "../src/execution-failure.js";
import { unknownWriterActivations } from "../src/lineage.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Cause, Effect, Exit, FiberId } from "effect";
import { JournalRuntime } from "../src/run-runtime.js";
import { RunStore, activationKey } from "../src/run-store.js";
import type { ExecutionPlan } from "../src/execution-types.js";
import type { Node } from "../src/graph.js";
import type { RuntimeContext } from "../src/runtime-contract.js";

const context: RuntimeContext = { graphId: "main", nodeId: "work", scope: ["root"], visit: 0 };
const key = activationKey(context);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(10); }
  throw new Error("Runtime test condition timeout");
}
async function fixture(t: TestContext, node: Node = { id: "work", kind: "end", value: { op: "literal", value: null } }) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-runtime-test-"));
  const store = new RunStore(join(directory, "state.sqlite"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const plan = { version: 1, runtimeVersion: "dynamicwf-runtime-v1", compilerVersion: "test", source: "", sourceHash: "test", hash: "test", agents: {}, workflow: { schemaVersion: 1, id: "test", name: "Test", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [node], edges: [] } } } } as ExecutionPlan;
  store.create({ id: "run", plan, input: null, cwd: directory });
  const { token, run } = store.reserveLaunch("run");
  const runtime = new JournalRuntime(store, run, token, directory);
  return { directory, store, token, run, runtime };
}

test("completed activation replay returns persisted output without invoking work", async t => {
  const f = await fixture(t);
  let calls = 0;
  const work = () => Effect.sync(() => { calls++; return { value: calls }; });
  assert.deepEqual(await Effect.runPromise(f.runtime.step(context, work)), { value: 1 });
  assert.deepEqual(await Effect.runPromise(f.runtime.step(context, work)), { value: 1 });
  assert.equal(calls, 1);
  assert.equal(f.store.getActivation("run", key)?.attempt, 1);
});

test("pause gates admission and resume releases the pending step", async t => {
  const f = await fixture(t);
  f.store.requestControl("run", "pause");
  let admitted = false;
  const running = Effect.runPromise(f.runtime.step(context, () => Effect.sync(() => { admitted = true; return 42; })));
  await until(() => f.store.get("run").status === "paused");
  assert.equal(admitted, false);
  assert.equal(f.store.listActivations("run").length, 0);
  f.store.requestControl("run", "resume");
  assert.equal(await running, 42);
  assert.equal(admitted, true);
});

test("cancel while paused admits no activation", async t => {
  const f = await fixture(t); f.store.requestControl("run", "pause");
  let admitted = false;
  const running = Effect.runPromiseExit(f.runtime.step(context, () => Effect.sync(() => { admitted = true; return null; })));
  await until(() => f.store.get("run").status === "paused");
  f.store.requestControl("run", "cancel");
  assert.ok(Exit.isFailure(await running));
  assert.equal(admitted, false); assert.equal(f.store.listActivations("run").length, 0);
});

test("ownership loss fences old completion and release without altering new owner", async t => {
  const f = await fixture(t);
  let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
  const running = Effect.runPromiseExit(f.runtime.step(context, () => Effect.promise(() => pending).pipe(Effect.as(42))));
  await until(() => f.store.getActivation("run", key)?.status === "running");
  // No external process exists in this fixture: simulate completed liveness recovery.
  f.store.markInterrupted("run", f.token, "No external worker");
  const replacement = f.store.reserveLaunch("run");
  finish();
  assert.ok(Exit.isFailure(await running));
  assert.equal(f.store.get("run").ownerToken, replacement.token);
  assert.equal(f.store.getActivation("run", key)?.status, "interrupted");
});

test("interruption awaits actual check cleanup before clearing PID and releasing activation", { timeout: 15000 }, async t => {
  const f = await fixture(t, { id: "work", kind: "check", command: process.execPath, args: [] });
  const started = join(f.directory, "started"), cleaned = join(f.directory, "cleaned");
  const node: Extract<Node, { kind: "check" }> = { id: "work", kind: "check", command: process.execPath, args: ["-e", `const fs=require('node:fs');process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(cleaned)},'clean');process.exit(0)},250));fs.writeFileSync(${JSON.stringify(started)},String(process.pid));setInterval(()=>{},1000);`] };
  const controller = new AbortController(); let settled = false; let worker: number | undefined;
  const running = Effect.runPromiseExit(f.runtime.step(context, () => f.runtime.check(context, node)), { signal: controller.signal }).then(result => { settled = true; return result; });
  t.after(async () => { controller.abort(); await running; });
  await until(async () => { try { await readFile(started); return true; } catch { return false; } });
  worker = f.store.getActivation("run", key)?.metadata.workerPid as number;
  assert.ok(worker);
  controller.abort();
  await delay(40);
  assert.equal(settled, false, "Effect interruption must await child cancellation promise");
  assert.equal(f.store.getActivation("run", key)?.status, "running");
  assert.equal(f.store.getActivation("run", key)?.metadata.workerPid, worker);
  assert.throws(() => f.store.finish("run", f.token, { status: "failed", error: "too early" }), /running activations/);
  assert.ok(Exit.isFailure(await running));
  assert.equal(await readFile(cleaned, "utf8"), "clean");
  assert.equal(f.store.getActivation("run", key)?.metadata.workerPid, null);
  assert.equal(f.store.getActivation("run", key)?.status, "failed");
  assert.throws(() => process.kill(worker!, 0), { code: "ESRCH" });
});

test("a resume racing pause marking must not fail the runtime", async t => {
  const f = await fixture(t); f.store.requestControl("run", "pause");
  const actual = f.store.markPaused.bind(f.store);
  f.store.markPaused = (id, token) => { f.store.requestControl(id, "resume"); actual(id, token); };
  assert.doesNotThrow(() => f.runtime.updatePause());
  assert.equal(f.store.get("run").status, "running");
});

test("step preserves every cause before collect instead of converting dangerous mixtures to data", async t => {
  const f = await fixture(t);
  const ordinary = executionFailure("output", "output", "read-only", "ordinary");
  const secondary = [Cause.fail(executionFailure("process", "cleanup", "unknown", "cleanup failed")), Cause.fail(executionFailure("interrupted", "execution", "unknown", "interrupted")), Cause.interrupt(FiberId.none), Cause.die(new Error("defect"))];
  for (const [i, cause] of secondary.entries()) {
    const current = { ...context, visit: i };
    const result = await Effect.runPromiseExit(f.runtime.collect(current, `case${i}`, () => f.runtime.step(current, () => Effect.failCause(Cause.parallel(Cause.fail(ordinary), cause)))));
    assert.ok(Exit.isFailure(result));
    assert.match(Cause.pretty(result.cause), /ordinary/);
    assert.equal(f.store.collection("run", activationKey(current), `case${i}`), undefined);
  }
});

test("failed check plus cleanup checkpoint fault retains both causes and blocks collection", async t => {
  const node = { id: "work", kind: "check", command: "/dynamicwf-missing", args: [] } as const;
  const f = await fixture(t, { ...node, args: [] });
  const original = f.store.setActivationMetadata.bind(f.store);
  f.store.setActivationMetadata = (id, token, key, metadata) => {
    if (metadata.workerLaunch === "settled") throw new Error("injected cleanup storage fault");
    return original(id, token, key, metadata);
  };
  const result = await Effect.runPromiseExit(f.runtime.collect(context, "failed", () => f.runtime.step(context, () => f.runtime.check(context, { ...node, args: [] }))));
  assert.ok(Exit.isFailure(result));
  const causes = Array.from(Cause.failures(result.cause)) as ExecutionFailure[];
  assert.equal(causes.length, 2);
  assert.equal(causes[0]!.failure.phase, "setup"); assert.equal(causes[1]!.failure.phase, "cleanup");
  const record = f.store.getActivation("run", key)!;
  assert.equal(record.metadata.workerGroupState, "pending");
  assert.equal((record.metadata.failureCauses as any[]).length, 2);
  assert.equal(unknownWriterActivations([record]).length, 1, "secondary unknown effects require continuation disposition");
  assert.equal(f.store.collection("run", key, "failed"), undefined);
});

test("interrupt waits for cleanup and retains its failure diagnostic", { timeout: 15000 }, async t => {
  const node: Extract<Node, { kind: "check" }> = { id: "work", kind: "check", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] };
  const f = await fixture(t, node);
  const original = f.store.setActivationMetadata.bind(f.store);
  f.store.setActivationMetadata = (id, token, key, metadata) => {
    if (metadata.workerLaunch === "settled") throw new Error("injected cleanup fault");
    return original(id, token, key, metadata);
  };
  const controller = new AbortController();
  const running = Effect.runPromiseExit(f.runtime.step(context, () => f.runtime.check(context, node)), { signal: controller.signal });
  t.after(async () => { controller.abort(); await running; });
  await until(() => typeof f.store.getActivation("run", key)?.metadata.workerPid === "number");
  controller.abort(); const result = await running;
  assert.ok(Exit.isFailure(result)); assert.equal(Cause.isInterrupted(result.cause), true);
  assert.ok(Array.from(Cause.defects(result.cause)).some(error => error instanceof ExecutionFailure && error.failure.phase === "cleanup"));
  assert.equal((f.store.getActivation("run", key)!.metadata.failure as any).phase, "cleanup");
});
