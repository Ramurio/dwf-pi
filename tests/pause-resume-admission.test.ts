import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Cause, Effect, Exit, Option } from "effect";
import { JournalRuntime } from "../src/run-runtime.js";
import { RunNotAcceptingWork, RunStore, activationKey } from "../src/run-store.js";
import type { ExecutionPlan } from "../src/execution-types.js";
import type { Node } from "../src/graph.js";
import type { RuntimeContext } from "../src/runtime-contract.js";

const context: RuntimeContext = { graphId: "main", nodeId: "work", scope: ["root"], visit: 0 };
const key = activationKey(context);
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

for (const action of ["resume", "cancel", "owner-loss"] as const) {
  test(`atomic pause refusal followed by ${action}`, { timeout: 5000 }, async t => {
    const f = await fixture(t);
    const begin = f.store.beginActivation.bind(f.store);
    const gate = f.runtime.gate.bind(f.runtime);
    let admissions = 0, gates = 0, calls = 0;
    let refused: unknown;
    f.runtime.gate = async signal => { gates++; assert.ok(gates <= 2); return gate(signal); };
    f.store.beginActivation = (...args) => {
      admissions++;
      if (admissions !== 1) return begin(...args);
      f.store.requestControl("run", "pause");
      try { return begin(...args); }
      catch (error) { refused = error; throw error; }
      finally {
        if (action === "owner-loss") {
          f.store.markInterrupted("run", f.token, "Offline ownership replacement");
          f.store.requestControl("run", "resume");
          f.store.reserveLaunch("run");
        } else f.store.requestControl("run", action);
      }
    };
    const exit = await Effect.runPromiseExit(f.runtime.step(context, () => { calls++; return Effect.succeed(42); }));
    assert.ok(refused instanceof RunNotAcceptingWork);
    assert.equal(refused.desired, "paused");
    assert.equal(refused.message, `Run is not accepting work: ${refused.desired}/${refused.status}`);
    if (action === "resume") {
      assert.ok(Exit.isSuccess(exit));
      assert.equal(exit.value, 42);
      assert.equal(calls, 1);
      assert.equal(admissions, 2);
      assert.equal(gates, 2);
      const page = f.store.attempts("run", key);
      assert.equal(page.current.attempt, 1);
      assert.equal(page.current.status, "succeeded");
      assert.deepEqual(page.records, []);
    } else {
      assert.ok(Exit.isFailure(exit));
      assert.equal(Option.getOrThrow(Cause.failureOption(exit.cause)), refused);
      assert.equal(calls, 0);
      assert.equal(admissions, 1);
      assert.equal(gates, 1);
      assert.deepEqual(f.store.listActivations("run"), []);
    }
  });
}

for (const typed of [false, true]) {
  test(`admitted work failure is not admission retry (typed=${typed})`, async t => {
    const f = await fixture(t);
    const error = typed ? new RunNotAcceptingWork("paused", "pausing") : new Error("Run is not accepting work: paused/pausing");
    let calls = 0, gates = 0;
    const gate = f.runtime.gate.bind(f.runtime);
    f.runtime.gate = async signal => { assert.equal(++gates, 1, "must not re-enter gate"); return gate(signal); };
    const exit = await Effect.runPromiseExit(f.runtime.step(context, () => {
      calls++;
      f.store.requestControl("run", "pause");
      return Effect.fail(error);
    }));
    assert.ok(Exit.isFailure(exit));
    assert.equal(Option.getOrThrow(Cause.failureOption(exit.cause)), error);
    assert.equal(calls, 1);
    assert.equal(gates, 1);
    assert.equal(f.store.getActivation("run", key)?.status, "failed");
    assert.equal(f.store.getActivation("run", key)?.attempt, 1);
  });
}

test("definition-changed refusal remains an ordinary error without retry", async t => {
  const f = await fixture(t);
  f.store.beginActivation("run", f.token, context, { kind: "map", sideEffect: false });
  f.store.completeActivation("run", f.token, key, null);
  const begin = f.store.beginActivation.bind(f.store);
  let original: unknown, admissions = 0, gates = 0;
  f.store.beginActivation = (...args) => {
    admissions++;
    try { return begin(...args); } catch (error) { original = error; throw error; }
  };
  const gate = f.runtime.gate.bind(f.runtime);
  f.runtime.gate = async signal => { assert.equal(++gates, 1); return gate(signal); };
  const exit = await Effect.runPromiseExit(f.runtime.step(context, () => { assert.fail("work must not run"); }));
  assert.ok(Exit.isFailure(exit));
  assert.equal(Option.getOrThrow(Cause.failureOption(exit.cause)), original);
  assert.ok(original instanceof Error && !(original instanceof RunNotAcceptingWork));
  assert.match(original.message, /Activation definition changed/);
  assert.equal(admissions, 1);
  assert.equal(gates, 1);
});
