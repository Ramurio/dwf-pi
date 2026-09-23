import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Exit } from "effect";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { RunNotAcceptingWork, RunStore, activationKey } from "../src/run-store.js";
import { MissingReference } from "../src/expressions.js";
import { executionFailure } from "../src/execution-failure.js";
import { parseOperation } from "../src/operation-record.js";
import { recoveryBlockers } from "../src/recovery-inspection.js";
import type { Node } from "../src/graph.js";

const context = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 }, key = activationKey(context);
const node: Extract<Node, { kind: "agent" }> = { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Task" }, config: { tools: [] } };
async function fixture(t: TestContext, retry = false, session: "fresh" | "continue-node" = "fresh") {
  const directory = await mkdtemp(join(tmpdir(), "dwf-atomic-intent-")), filename = join(directory, "state.sqlite"), store = new RunStore(filename);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "atomic", name: "Atomic operation", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [{ ...node, config: { ...node.config, session }, ...(retry ? { retryPolicy: { codes: ["expression"], delayMs: 0, maxAttempts: 2 } } : {}) }, { id: "done", kind: "end", value: { op: "literal", value: null } }], edges: [{ from: "work", to: "done" }] } } }, { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
  store.create({ id: "run", plan, cwd: directory, input: null });
  const { run, token } = store.reserveLaunch("run");
  return { directory, filename, store, token, runtime: new JournalRuntime(store, run, token, directory) };
}

for (const point of ["activation", "event"] as const) test(`failed ${point} transaction prevents dispatch and rolls back intent`, async t => {
  const f = await fixture(t), db = new DatabaseSync(f.filename), events = f.store.events("run");
  try {
    db.exec(point === "activation"
      ? "CREATE TRIGGER deny_intent BEFORE INSERT ON workflow_activations WHEN json_extract(NEW.metadata,'$.operation.kind')='agent' BEGIN SELECT RAISE(ABORT,'injected intent rejection'); END"
      : "CREATE TRIGGER deny_intent BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.started' BEGIN SELECT RAISE(ABORT,'injected event rejection'); END");
    let prepared = 0;
    const result = await Effect.runPromiseExit(f.runtime.stepOperation(context, node, () => { prepared++; return { kind: "agent", task: "Actual confidential task", input: { from: "upstream" } }; }));
    assert.ok(Exit.isFailure(result)); assert.equal(prepared, 1);
    assert.deepEqual(f.store.listActivations("run"), []);
    assert.deepEqual(f.store.events("run"), events);
    assert.deepEqual(f.store.usageReports("run").reports, []);
    assert.ok((await readdir(f.directory)).every(name => name.startsWith("state.sqlite")), "no resource/session/worker directories before commit");
  } finally { db.close(); }
});

test("successful checkpoint skips preparation and returns an independent result", async t => {
  const f = await fixture(t);
  f.store.beginActivation("run", f.token, context, { kind: "agent", sideEffect: true });
  f.store.completeActivation("run", f.token, key, { answer: [1] });
  const events = f.store.events("run"); let prepared = 0;
  const output = await Effect.runPromise(f.runtime.stepOperation(context, node, () => { prepared++; throw Error("must not evaluate"); }));
  assert.deepEqual(output, { answer: [1] }); assert.equal(prepared, 0);
  (output as { answer: number[] }).answer.push(2);
  assert.deepEqual(f.store.getActivation("run", key)!.output, { answer: [1] });
  assert.deepEqual(f.store.events("run"), events);
});

for (const action of ["resume", "cancel", "owner-loss"] as const) test(`atomic preparation follows admission refusal then ${action}`, async t => {
  const f = await fixture(t), begin = f.store.beginActivation.bind(f.store); let admitted = 0, prepared = 0;
  f.store.beginActivation = (...args) => {
    if (++admitted !== 1) return begin(...args);
    f.store.requestControl("run", "pause");
    try { return begin(...args); } finally {
      if (action === "owner-loss") { f.store.markInterrupted("run", f.token, "fixture"); f.store.requestControl("run", "resume"); f.store.reserveLaunch("run"); }
      else f.store.requestControl("run", action);
    }
  };
  const result = await Effect.runPromiseExit(f.runtime.stepOperation(context, node, () => { prepared++; throw new MissingReference(["input", "missing"]); }));
  assert.ok(Exit.isFailure(result));
  assert.equal(prepared, action === "resume" ? 1 : 0);
  assert.equal(admitted, action === "resume" ? 2 : 1);
  const records = f.store.listActivations("run");
  assert.equal(records.length, action === "resume" ? 1 : 0);
  if (action === "resume") { assert.equal(records[0]!.status, "failed"); assert.equal(records[0]!.attempt, 1); }
});

test("preparation errors retain failed checkpoints without fabricated intent or implicit recovery", async t => {
  const f = await fixture(t); let calls = 0;
  const result = await Effect.runPromiseExit(f.runtime.stepOperation(context, node, () => { calls++; throw new MissingReference(["nodes", "absent"]); }));
  assert.ok(Exit.isFailure(result)); assert.equal(calls, 1);
  const record = f.store.getActivation("run", key)!;
  assert.equal(record.status, "failed"); assert.equal(record.metadata.operation, undefined);
  assert.equal(record.metadata.operationPreparationFailed, true);
  assert.equal((record.metadata.failure as { code: string }).code, "expression");
  f.store.markInterrupted("run", f.token, "fixture stop");
  assert.ok(recoveryBlockers(f.store.get("run"), record, [record], []).some(b => b.code === "missing-operation"));
});

test("preparation errors retain the existing explicit retry policy and archive each attempt", async t => {
  const f = await fixture(t, true); let calls = 0;
  const result = await Effect.runPromiseExit(f.runtime.stepOperation(context, node, () => { calls++; throw executionFailure("expression", "execution", "read-only", "Typed fixture failure"); }));
  assert.ok(Exit.isFailure(result)); assert.equal(calls, 2);
  const page = f.store.attempts("run", key);
  assert.equal(page.current.attempt, 2); assert.equal(page.records.length, 1);
  assert.equal(page.records[0]!.metadata.operationPreparationFailed, true);
  assert.equal(page.current.metadata.operation, undefined);
});

test("typed work-like error during preparation is not mistaken for rejected admission", async t => {
  const f = await fixture(t); let calls = 0;
  assert.ok(Exit.isFailure(await Effect.runPromiseExit(f.runtime.stepOperation(context, node, () => { calls++; throw new RunNotAcceptingWork("paused", "pausing"); }))));
  assert.equal(calls, 1); assert.equal(f.store.getActivation("run", key)!.status, "failed");
});

test("malformed or mismatched intent rolls back admission before any attempt", async t => {
  const f = await fixture(t);
  for (const operation of [{ kind: "integrate", target: f.directory, sources: [] }, { kind: "agent", cwd: f.directory }]) {
    assert.throws(() => f.store.beginActivation("run", f.token, context, { kind: "agent", sideEffect: true, prepareOperation: () => operation as any }), /Invalid prepared operation/);
    assert.deepEqual(f.store.listActivations("run"), []);
  }
});


test("atomic intent preserves continue-node selection without reading sibling or future sessions", async t => {
  const f = await fixture(t, false, "continue-node");
  const prior = (visit: number, scope: string[], sessionFile: string) => {
    const ctx = { ...context, visit, scope }, record = f.store.beginActivation("run", f.token, ctx, { kind: "agent", sideEffect: true });
    f.store.completeActivation("run", f.token, record.key, {}, { sessionFile });
  };
  prior(0, context.scope, join(f.directory, "session-0.jsonl"));
  prior(1, context.scope, join(f.directory, "session-1.jsonl"));
  prior(4, context.scope, join(f.directory, "future.jsonl"));
  prior(1, ["graph", "other"], join(f.directory, "sibling.jsonl"));
  const current = { ...context, visit: 2 };
  f.store.startUsage = () => { throw Error("Fixture stop after admission before worker dispatch"); };
  assert.ok(Exit.isFailure(await Effect.runPromiseExit(f.runtime.stepOperation(current, node, () => ({ kind: "agent", task: "continued", input: null })))));
  const operation = parseOperation(f.store.getActivation("run", activationKey(current))!.metadata.operation)!;
  assert.equal(operation.kind, "agent"); if (operation.kind !== "agent") return;
  assert.equal(operation.continuedSessionFile, join(f.directory, "session-1.jsonl"));
  assert.equal(operation.cwd, f.directory);
  assert.equal(operation.task, "continued"); assert.equal(operation.input, null);
  assert.ok((await readdir(f.directory)).every(name => name.startsWith("state.sqlite")));
});
