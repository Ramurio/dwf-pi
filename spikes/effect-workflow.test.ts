import assert from "node:assert/strict";
import test from "node:test";
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from "@effect/workflow";
import { Cause, Deferred, Effect, Exit, Schema } from "effect";

// Real memory engine, no mocked journal or Workflow implementation. All waits are
// bounded; tests exercise only one engine lifetime unless explicitly stated.
const runMemory = <A, E>(
  program: Effect.Effect<A, E, WorkflowEngine.WorkflowEngine | import("effect/Scope").Scope>,
) => Effect.runPromise(program.pipe(
  Effect.scoped,
  Effect.provide(WorkflowEngine.layerMemory),
  Effect.timeout("5 seconds"),
));

const waitFor = <A, E, R>(
  poll: Effect.Effect<A, E, R>,
  predicate: (value: A) => boolean,
) => poll.pipe(Effect.delay("1 millis"), Effect.repeat({ until: predicate }), Effect.timeout("2 seconds"));

test("resume replays completed activities while workflow control flow runs again", async () => {
  let activityCalls = 0;
  let bodyCalls = 0;
  const workflow = Workflow.make({
    name: "ReplaySpike", payload: { run: Schema.String },
    success: Schema.Number, idempotencyKey: ({ run }) => run,
  });
  const gate = DurableDeferred.make("approval", { success: Schema.Boolean });
  const result = await runMemory(Effect.gen(function* () {
    const engine = yield* WorkflowEngine.WorkflowEngine;
    yield* engine.register(workflow, () => Effect.gen(function* () {
      bodyCalls++;
      const saved = yield* Activity.make({
        name: "worker/visit/0", success: Schema.Number,
        execute: Effect.sync(() => ++activityCalls),
      });
      yield* DurableDeferred.await(gate);
      return saved;
    }));
    const executionId = yield* workflow.execute({ run: "one" }, { discard: true });
    yield* waitFor(workflow.poll(executionId), (status) => status?._tag === "Suspended");
    assert.equal(activityCalls, 1);
    assert.equal(bodyCalls, 1);
    yield* DurableDeferred.succeed(gate, {
      token: DurableDeferred.tokenFromExecutionId(gate, { workflow, executionId }), value: true,
    });
    yield* waitFor(workflow.poll(executionId), (status) => status?._tag === "Complete");
    const first = yield* workflow.execute({ run: "one" });
    const repeated = yield* workflow.execute({ run: "one" });
    return { first, repeated };
  }));
  assert.deepEqual(result, { first: 1, repeated: 1 });
  assert.equal(activityCalls, 1);
  assert.equal(bodyCalls, 2, "resume must actually have replayed the workflow body");
});

for (const uniqueNames of [false, true]) {
  test(`loop activities ${uniqueNames ? "with visit IDs execute each visit" : "with reused names return stale first result"}`, async () => {
    let calls = 0;
    const workflow = Workflow.make({
      name: `LoopSpike-${uniqueNames}`, payload: { run: Schema.String },
      success: Schema.Array(Schema.Number), idempotencyKey: ({ run }) => run,
    });
    const values = await runMemory(Effect.gen(function* () {
      const engine = yield* WorkflowEngine.WorkflowEngine;
      yield* engine.register(workflow, () => Effect.gen(function* () {
        const outputs: number[] = [];
        for (let visit = 0; visit < 3; visit++) {
          outputs.push(yield* Activity.make({
            name: uniqueNames ? `review/visit/${visit}` : "review",
            success: Schema.Number,
            execute: Effect.sync(() => { calls++; return visit; }),
          }));
        }
        return outputs;
      }));
      return yield* workflow.execute({ run: "loop" });
    }));
    assert.deepEqual(values, uniqueNames ? [0, 1, 2] : [0, 0, 0]);
    assert.equal(calls, uniqueNames ? 3 : 1);
  });
}

test("memory engine state is lost when its layer is recreated", async () => {
  let calls = 0;
  const workflow = Workflow.make({
    name: "MemoryLifetimeSpike", payload: { run: Schema.String },
    success: Schema.Number, idempotencyKey: ({ run }) => run,
  });
  const program = Effect.gen(function* () {
    const engine = yield* WorkflowEngine.WorkflowEngine;
    yield* engine.register(workflow, () => Activity.make({
      name: "worker/visit/0", success: Schema.Number,
      execute: Effect.sync(() => ++calls),
    }));
    return yield* workflow.execute({ run: "same-id" });
  });
  assert.equal(await runMemory(program), 1);
  assert.equal(await runMemory(program), 2);
});

test("memory interrupt waits for active work; activity and workflow finalizers then run", async () => {
  const events: string[] = [];
  const workflow = Workflow.make({
    name: "InterruptSpike", payload: { run: Schema.String },
    idempotencyKey: ({ run }) => run,
  });
  await runMemory(Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const engine = yield* WorkflowEngine.WorkflowEngine;
    yield* engine.register(workflow, () => Effect.gen(function* () {
      yield* Workflow.addFinalizer((exit) => Effect.sync(() => {
        events.push(Exit.isFailure(exit) ? "workflow-failure-finalizer" : "workflow-success-finalizer");
      }));
      yield* Activity.make({
        name: "worker/visit/0",
        execute: Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => { events.push("activity-finalizer"); }));
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          events.push("activity-completed");
        }),
      });
    }));
    const executionId = yield* workflow.execute({ run: "cancel" }, { discard: true });
    yield* Deferred.await(started);
    yield* workflow.interrupt(executionId);
    assert.deepEqual(events, [], "interrupt did not forcibly stop an active activity");
    assert.equal(yield* workflow.poll(executionId), undefined);
    yield* Deferred.succeed(release, undefined);
    const result = yield* waitFor(workflow.poll(executionId), (status) => status?._tag === "Complete");
    assert.equal(result?._tag, "Complete");
    if (result?._tag !== "Complete") throw new Error("Expected completion");
    assert.equal(Exit.isFailure(result.exit), true);
    if (Exit.isFailure(result.exit)) assert.equal(Cause.isInterrupted(result.exit.cause), true);
  }));
  assert.deepEqual(events, ["activity-completed", "activity-finalizer", "workflow-failure-finalizer"]);
});
