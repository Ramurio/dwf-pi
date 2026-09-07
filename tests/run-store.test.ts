import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { RunStore, activationKey } from "../src/run-store.js";
import type { ExecutionPlan } from "../src/execution-types.js";
import type { RuntimeContext } from "../src/runtime-contract.js";

const plan = {
  version: 1, runtimeVersion: "dynamicwf-runtime-v1", compilerVersion: "test", source: "", sourceHash: "source", hash: "plan", agents: {},
  workflow: { version: 1, id: "workflow", name: "Workflow", revision: 1, entryGraph: "main", graphs: {} },
} as unknown as ExecutionPlan;
const context: RuntimeContext = { scope: ["root"], graphId: "main", nodeId: "work", visit: 0 };
const key = activationKey(context);
const create = (store: RunStore, id = "run") => store.create({ id, plan, input: { request: "test" }, cwd: "/tmp" });

async function withStores(work: (first: RunStore, second: RunStore, filename: string) => Promise<void> | void) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-journal-"));
  const filename = join(directory, "state.sqlite");
  const first = new RunStore(filename);
  const second = new RunStore(filename);
  try { await work(first, second, filename); }
  finally { first.close(); second.close(); await rm(directory, { recursive: true, force: true }); }
}

test("run snapshots, completed null output, ordered cursor events and terminal result persist across connections", async () => {
  await withStores((first, second) => {
    const original = create(first);
    original.plan.hash = "mutated";
    assert.equal(second.get("run").plan.hash, "plan");
    assert.throws(() => create(second), /already exists/);
    const { token } = first.reserveLaunch("run");
    first.attachPid("run", token, process.pid);
    second.heartbeat("run", token);
    first.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    first.setActivationMetadata("run", token, key, { workerPid: 100, sessionFile: "session.jsonl" });
    second.completeActivation("run", token, key, null, { workerPid: null });
    assert.deepEqual(first.completed("run", key), { output: null });
    assert.equal(second.listActivations("run")[0]?.metadata.sessionFile, "session.jsonl");
    first.finish("run", token, { status: "succeeded", output: { result: null } });
    assert.equal(second.get("run").status, "succeeded");
    assert.deepEqual(second.get("run").output, { result: null });
    const events = second.events("run");
    assert.deepEqual(events.map(e => e.type), ["run.created", "run.reserved", "run.started", "activation.started", "activation.metadata", "activation.succeeded", "run.succeeded"]);
    assert.deepEqual(first.events("run", events[3]!.seq), events.slice(4));
    assert.equal(first.listRuns().length, 1);
    assert.equal(second.get("run").ownerToken, null);
    assert.throws(() => first.appendEvent("run", token, "late", {}), /Stale/);
    for (const command of ["pause", "resume", "cancel"] as const) assert.equal(first.requestControl("run", command).status, "succeeded");
  });
});

test("launch CAS fences all stale-owner writes, and uncertain side effects are never replayed implicitly", async () => {
  await withStores((first, second) => {
    create(first);
    const old = first.reserveLaunch("run").token;
    assert.throws(() => second.reserveLaunch("run"), /not launchable/);
    first.beginActivation("run", old, context, { kind: "agent", sideEffect: true });
    first.markInterrupted("run", old, "Verified dead externally");
    assert.equal(second.getActivation("run", key)?.status, "interrupted");
    const current = second.reserveLaunch("run").token;
    assert.notEqual(old, current);
    for (const mutate of [
      () => first.attachPid("run", old, process.pid),
      () => first.heartbeat("run", old),
      () => first.beginActivation("run", old, { ...context, visit: 1 }, { kind: "agent", sideEffect: true }),
      () => first.completeActivation("run", old, key, "late result"),
      () => first.failActivation("run", old, key, "late error"),
      () => first.setActivationMetadata("run", old, key, { workerPid: 12 }),
      () => first.markPaused("run", old),
      () => first.markInterrupted("run", old, "late crash"),
      () => first.appendEvent("run", old, "late", {}),
      () => first.finish("run", old, { status: "failed", error: "late failure" }),
    ]) assert.throws(mutate, /Stale/);
    assert.throws(() => second.beginActivation("run", current, context, { kind: "agent", sideEffect: true }), /explicit retry authorization/);
    assert.equal(second.getActivation("run", key)?.attempt, 1);
    assert.equal(first.get("run").ownerToken, current);
  });
});

test("recovery replays successful checkpoints, retries interrupted structural and pure work", async () => {
  await withStores((store) => {
    create(store);
    const { token } = store.reserveLaunch("run");
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    store.completeActivation("run", token, key, "done");
    const parent = { ...context, nodeId: "map" };
    const pure = { ...context, nodeId: "transform" };
    store.beginActivation("run", token, parent, { kind: "map", sideEffect: false });
    store.beginActivation("run", token, pure, { kind: "transform", sideEffect: false });
    store.markInterrupted("run", token, "confirmed exit");
    const next = store.reserveLaunch("run").token;
    assert.deepEqual(store.completed("run", key), { output: "done" });
    assert.equal(store.beginActivation("run", next, context, { kind: "agent", sideEffect: true }).attempt, 1);
    assert.equal(store.beginActivation("run", next, parent, { kind: "map", sideEffect: false }).attempt, 2);
    assert.equal(store.beginActivation("run", next, pure, { kind: "transform", sideEffect: false }).attempt, 2);
  });
});

test("pause drains leaves, preserves live owner and structural work, resume uses same reservation", async () => {
  await withStores((store, control) => {
    create(store);
    const { token } = store.reserveLaunch("run");
    store.attachPid("run", token, process.pid);
    const parent = { ...context, nodeId: "parent" };
    store.beginActivation("run", token, parent, { kind: "parallel", sideEffect: false });
    store.beginActivation("run", token, context, { kind: "check", sideEffect: true });
    assert.equal(control.requestControl("run", "pause").status, "pausing");
    const events = store.events("run").length;
    control.requestControl("run", "pause");
    assert.equal(store.events("run").length, events);
    assert.throws(() => store.beginActivation("run", token, { ...context, visit: 1 }, { kind: "agent", sideEffect: true }), /not accepting work/);
    assert.throws(() => store.markPaused("run", token), /leaf activations/);
    store.completeActivation("run", token, key, { ok: true });
    store.markPaused("run", token);
    assert.equal(store.get("run").status, "paused");
    assert.equal(store.get("run").ownerToken, token);
    assert.equal(store.get("run").supervisorPid, process.pid);
    assert.equal(store.getActivation("run", activationKey(parent))?.status, "running");
    store.heartbeat("run", token);
    assert.throws(() => store.reserveLaunch("run"), /not launchable/);
    assert.equal(control.requestControl("run", "resume").status, "running");
    assert.equal(store.get("run").ownerToken, token);
    store.completeActivation("run", token, activationKey(parent), ["done"]);
    store.finish("run", token, { status: "succeeded", output: ["done"] });
  });
});

test("control cancellation is monotonic, completion cannot invent cancellation or success, never-launched controls need no supervisor", async () => {
  await withStores((store) => {
    create(store);
    assert.equal(store.requestControl("run", "pause").status, "paused");
    assert.equal(store.requestControl("run", "resume").status, "queued");
    const { token } = store.reserveLaunch("run");
    assert.throws(() => store.finish("run", token, { status: "cancelled" }), /not requested/);
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    assert.equal(store.requestControl("run", "cancel").status, "cancelling");
    for (const command of ["resume", "pause", "cancel"] as const) assert.equal(store.requestControl("run", command).status, "cancelling");
    assert.throws(() => store.finish("run", token, { status: "cancelled" }), /running activations/);
    assert.throws(() => store.finish("run", token, { status: "succeeded", output: "pretend" }), /cancelled is requested/);
    store.failActivation("run", token, key, "worker terminated");
    store.finish("run", token, { status: "cancelled" });
    assert.equal(store.get("run").status, "cancelled");
    assert.equal(store.completed("run", key), undefined);
    create(store, "unlaunched");
    assert.equal(store.requestControl("unlaunched", "cancel").status, "cancelled");
    create(store, "dead-cancelling");
    const dead = store.reserveLaunch("dead-cancelling").token;
    store.requestControl("dead-cancelling", "cancel");
    store.markInterrupted("dead-cancelling", dead, "confirmed dead");
    assert.equal(store.requestControl("dead-cancelling", "cancel").status, "cancelled");
  });
});

test("event insertion failure rolls back activation completion and final run result in the same transaction", async () => {
  await withStores((store, _, filename) => {
    create(store);
    const { token } = store.reserveLaunch("run");
    store.beginActivation("run", token, context, { kind: "transform", sideEffect: false });
    const db = new DatabaseSync(filename);
    try {
      db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON workflow_run_events WHEN NEW.type='activation.succeeded' BEGIN SELECT RAISE(ABORT, 'injected journal failure'); END");
      const before = store.events("run");
      assert.throws(() => store.completeActivation("run", token, key, "lost output"), /injected journal failure/);
      assert.equal(store.getActivation("run", key)?.status, "running");
      assert.equal(store.completed("run", key), undefined);
      assert.deepEqual(store.events("run"), before);
      db.exec("DROP TRIGGER fail_event");
      store.completeActivation("run", token, key, "actual output");
      db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON workflow_run_events WHEN NEW.type='run.succeeded' BEGIN SELECT RAISE(ABORT, 'injected journal failure'); END");
      assert.throws(() => store.finish("run", token, { status: "succeeded", output: "lost final output" }), /injected journal failure/);
      assert.equal(store.get("run").status, "running");
      assert.equal(store.get("run").output, undefined);
      db.exec("DROP TRIGGER fail_event");
      store.finish("run", token, { status: "succeeded", output: "actual final output" });
    } finally { db.close(); }
  });
});

test("activation identities do not collide across scope delimiters, nested graphs or visits", () => {
  const identities = [
    { ...context, scope: ["a/b", "c"] }, { ...context, scope: ["a", "b/c"] },
    { ...context, scope: ["a", "b", "c"] }, { ...context, graphId: "other" },
    { ...context, visit: 1 }, context,
  ].map(activationKey);
  assert.equal(new Set(identities).size, identities.length);
});

test("concurrent processes initialize journal and reserve a run exactly once", async () => {
  await withStores(async (store, _, filename) => {
    create(store);
    const code = `import { RunStore } from ${JSON.stringify(resolve("src/run-store.ts"))};
      const store = new RunStore(process.argv[1]);
      try { const result=store.reserveLaunch('run'); process.stdout.write(JSON.stringify({won:true,token:result.token})); }
      catch(e) { if(!String(e).includes('not launchable')) throw e; process.stdout.write(JSON.stringify({won:false})); }
      finally { store.close(); }`;
    const results = await Promise.all(Array.from({ length: 8 }, () => new Promise<{ won: boolean; token?: string }>((resolveResult, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, filename], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "", error = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 20_000);
      child.stdout.setEncoding("utf8").on("data", data => { output += data; });
      child.stderr.setEncoding("utf8").on("data", data => { error += data; });
      child.once("error", reason => { clearTimeout(timer); reject(reason); });
      child.once("close", code => {
        clearTimeout(timer);
        if (code !== 0) { reject(new Error(`${code}: ${error}`)); return; }
        try { resolveResult(JSON.parse(output)); } catch (reason) { reject(reason); }
      });
    })));
    assert.equal(results.filter(result => result.won).length, 1);
    assert.equal(store.get("run").ownerToken, results.find(result => result.won)?.token);
    assert.equal(store.events("run").filter(event => event.type === "run.reserved").length, 1);
  });
});
