import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { executionFailure } from "../src/execution-failure.js";
import type { ExecutionPlan } from "../src/execution-types.js";
import type { Json, Node } from "../src/graph.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { activationKey, RunStore } from "../src/run-store.js";
import type { RuntimeContext } from "../src/runtime-contract.js";

const context: RuntimeContext = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 };
const key = activationKey(context);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (predicate()) return; await delay(10); }
  throw new Error("wave5-b03 condition timeout");
}
function planFor(node: Node): ExecutionPlan {
  return {
    version: 1, runtimeVersion: "dynamicwf-runtime-v1", compilerVersion: "test", source: "", sourceHash: "test", hash: "test", agents: {},
    workflow: { schemaVersion: 1, id: "b03", name: "B03", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [node], edges: [] } } },
  } as ExecutionPlan;
}
async function fixture(t: TestContext, node: Node) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-wave5-b03-"));
  const store = new RunStore(join(directory, "state.sqlite"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  store.create({ id: "run-b03", plan: planFor(node), input: null, cwd: directory });
  const launch = store.reserveLaunch("run-b03");
  return { store, token: launch.token, runtime: new JournalRuntime(store, launch.run, launch.token, directory) };
}
const agentNode: Node = {
  id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Offline" },
  retryPolicy: { codes: ["provider"], delayMs: 0, maxAttempts: 2 },
};
const endNode: Node = { id: "work", kind: "end", value: { op: "literal", value: null } };

test("same-owner JournalRuntime retry archives attempt 1 output and usage instead of applying them to attempt 2", async t => {
  const f = await fixture(t, agentNode);
  const owner = f.token;
  let calls = 0;
  const result = await Effect.runPromise(f.runtime.step(context, () => {
    const activation = f.store.getActivation("run-b03", key)!;
    calls++;
    assert.equal(activation.attempt, calls);
    if (calls === 2) assert.equal(activation.metadata.workerToken, undefined);
    f.store.setActivationMetadata("run-b03", f.token, key, { workerToken: calls === 1 ? "w1" : "w2", workerLaunch: "settled" });
    f.store.startUsage("run-b03", f.token, key);
    f.store.recordUsage("run-b03", f.token, key, "1", calls === 1 ? { input: 3, output: 1, totalTokens: 4 } : { input: 5, output: 2, totalTokens: 7 }, "stop");
    f.store.settleUsage("run-b03", f.token, key, true);
    if (calls === 1) return Effect.fail(executionFailure("provider", "execution", "read-only", "attempt-1-provider"));
    return Effect.succeed({ result: "attempt-2-output" });
  }));
  assert.deepEqual(result, { result: "attempt-2-output" });
  assert.equal(calls, 2);
  assert.equal(f.store.get("run-b03").ownerToken, owner);
  const page = f.store.attempts("run-b03", key);
  assert.equal(page.current.attempt, 2);
  assert.equal(page.current.status, "succeeded");
  assert.deepEqual(page.current.output, { result: "attempt-2-output" });
  assert.equal(page.current.metadata.workerToken, "w2");
  assert.equal(page.records.length, 1);
  assert.equal(page.records[0]!.attempt, 1);
  assert.equal(page.records[0]!.status, "failed");
  assert.equal(page.records[0]!.output, undefined);
  assert.match(page.records[0]!.error ?? "", /attempt-1-provider/);
  assert.equal(page.records[0]!.metadata.workerToken, "w1");
  assert.deepEqual(f.store.usageReports("run-b03").reports.map(report => [report.attempt, report.reportId, report.usage.totalTokens]), [[1, "1", 4], [2, "1", 7]]);
  assert.equal(page.records[0]!.accounting.usage!.totalTokens, 4);
  assert.equal(page.current.accounting.usage!.totalTokens, 7);
});

test("an overlapping JournalRuntime.step cannot open attempt 2; late success commits only attempt 1", async t => {
  const f = await fixture(t, endNode);
  let finish: ((value: Json) => void) | undefined;
  const pending = new Promise<Json>(resolve => { finish = resolve; });
  t.after(() => { finish?.({ result: "cleanup" }); });
  const first = Effect.runPromiseExit(f.runtime.step(context, () => Effect.promise(() => pending)));
  await until(() => f.store.getActivation("run-b03", key)?.status === "running");
  assert.equal(f.store.getActivation("run-b03", key)?.attempt, 1);
  const second = await Effect.runPromiseExit(f.runtime.step(context, () => Effect.succeed({ result: "from-overlapping-step" })));
  if (!Exit.isFailure(second)) assert.fail("expected overlapping step to fail");
  assert.match(Cause.pretty(second.cause), /already running/);
  assert.equal(f.store.getActivation("run-b03", key)?.attempt, 1);
  assert.equal(f.store.getActivation("run-b03", key)?.status, "running");
  finish!({ result: "late-from-first" });
  const done = await first;
  if (!Exit.isSuccess(done)) assert.fail("expected late first step to succeed");
  assert.deepEqual(done.value, { result: "late-from-first" });
  const activation = f.store.getActivation("run-b03", key)!;
  assert.equal(activation.attempt, 1);
  assert.equal(activation.status, "succeeded");
  assert.deepEqual(activation.output, { result: "late-from-first" });
  assert.equal(f.store.attempts("run-b03", key).records.length, 0);
  let calls = 0;
  const replayed = await Effect.runPromise(f.runtime.step(context, () => {
    calls++;
    return Effect.succeed({ result: "should-not-run" });
  }));
  assert.deepEqual(replayed, { result: "late-from-first" });
  assert.equal(calls, 0);
});

test("sequential replay of a failed pure activation archives attempt 1 before attempt 2 work runs", async t => {
  const f = await fixture(t, endNode);
  const first = await Effect.runPromiseExit(f.runtime.step(context, () => Effect.fail(new Error("attempt-1-work"))));
  assert.ok(Exit.isFailure(first));
  const failed = f.store.getActivation("run-b03", key)!;
  assert.equal(failed.attempt, 1);
  assert.equal(failed.status, "failed");
  let sawAttempt = 0;
  const second = await Effect.runPromise(f.runtime.step(context, () => {
    sawAttempt = f.store.getActivation("run-b03", key)!.attempt;
    return Effect.succeed({ result: "attempt-2-work" });
  }));
  assert.equal(sawAttempt, 2);
  assert.deepEqual(second, { result: "attempt-2-work" });
  const page = f.store.attempts("run-b03", key);
  assert.equal(page.current.attempt, 2);
  assert.deepEqual(page.current.output, { result: "attempt-2-work" });
  assert.match(page.records[0]!.error ?? "", /attempt-1-work/);
  assert.equal(page.records[0]!.output, undefined);
});
