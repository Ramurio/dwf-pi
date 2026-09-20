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
import { parseUsage, sumTokenUsage, summarizeUsage } from "../src/usage.js";
import { WorkflowService } from "../src/service.js";

const plan = {
  version: 1, runtimeVersion: "dynamicwf-runtime-v1", compilerVersion: "test", source: "", sourceHash: "source", hash: "plan", agents: {},
  workflow: { version: 1, id: "workflow", name: "Workflow", revision: 1, entryGraph: "main", graphs: {} },
} as unknown as ExecutionPlan;
const context: RuntimeContext = { scope: ["root"], graphId: "main", nodeId: "work", visit: 0 };
const key = activationKey(context);
const create = (store: RunStore, id = "run") => store.create({ id, plan, input: { request: "test" }, cwd: "/tmp" });

test("legacy journals migrate launch provenance and replace it atomically with ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-launch-migration-"));
  const filename = join(directory, "state.sqlite");
  let store = new RunStore(filename);
  try {
    create(store); store.close();
    const legacy = new DatabaseSync(filename);
    try { legacy.exec("ALTER TABLE workflow_runs DROP COLUMN supervisor_launch"); } finally { legacy.close(); }
    store = new RunStore(filename);
    assert.equal(store.get("run").supervisorLaunch, undefined);
    const launch = { script: "/installation one/src/supervisor.ts", store: filename };
    const { token } = store.reserveLaunch("run", false, launch);
    store.close(); store = new RunStore(filename);
    assert.deepEqual(store.get("run").supervisorLaunch, { ...launch, ownerToken: token });
    assert.throws(() => store.reserveLaunch("run", false, { ...launch, script: "/other/supervisor.ts" }), /not launchable/);
    assert.equal(store.get("run").supervisorLaunch?.ownerToken, token);
    store.markInterrupted("run", token, "fixture dead process");
    const next = store.reserveLaunch("run", false, { ...launch, script: "/other/supervisor.ts" });
    assert.notEqual(next.token, token);
    assert.equal(next.run.supervisorLaunch?.script, "/other/supervisor.ts");
    assert.equal(next.run.supervisorLaunch?.ownerToken, next.token);
    store.markInterrupted("run", next.token, "fixture dead process");
    assert.equal(store.reserveLaunch("run").run.supervisorLaunch, undefined);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("wait admission is fenced and resolution commits atomically with its event", async () => {
  await withStores((store, second, filename) => {
    create(store); const { token } = store.reserveLaunch("run");
    const schema = { type: "object", properties: { answer: { type: "boolean" } }, required: ["answer"], additionalProperties: false };
    store.beginActivation("run", token, context, { kind: "await", sideEffect: false });
    assert.throws(() => store.openWait("run", "stale", key, "Need answer", null, schema), /Stale/);
    const wait = store.openWait("run", token, key, "Need answer", null, schema);
    assert.equal(store.openWait("run", token, key, "Need answer", null, schema).id, wait.id);
    assert.throws(() => store.openWait("run", token, key, "Changed", null, schema), /differs/);
    const injection = new DatabaseSync(filename);
    try {
      injection.exec("CREATE TRIGGER reject_wait_event BEFORE INSERT ON workflow_run_events WHEN NEW.type='wait.resolved' BEGIN SELECT RAISE(ABORT, 'injected wait event failure'); END");
      assert.throws(() => store.resolveWait("run", wait.id, { answer: true }, "agent"), /injected/);
      assert.equal(second.getWait("run", wait.id).status, "open");
      assert.equal(second.events("run").filter(e => e.type === "wait.resolved").length, 0);
      injection.exec("DROP TRIGGER reject_wait_event");
      store.resolveWait("run", wait.id, { answer: true }, "agent");
      second.resolveWait("run", wait.id, { answer: true }, "duplicate");
      assert.equal(second.getWait("run", wait.id).resolvedBy, "agent");
      assert.equal(second.events("run").filter(e => e.type === "wait.resolved").length, 1);
      create(store, "other");
      assert.throws(() => second.resolveWait("other", wait.id, { answer: false }, "agent"), /not found in this run/);
    } finally { injection.close(); }
  });
});

test("mixed provider breakdown retains known subtotals across journal reads and aggregate composition", async () => {
  await withStores((store, second) => {
    create(store); const { token } = store.reserveLaunch("run");
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    store.startUsage("run", token, key);
    const known = { input: 2, output: 3, totalTokens: 15, cacheRead: 10, cacheWrite: 0, cost: 0.1 };
    const unknown = { input: 1, output: 1, totalTokens: 2 };
    store.recordUsage("run", token, key, "1", known, "toolUse");
    store.recordUsage("run", token, key, "2", unknown, "stop");
    store.settleUsage("run", token, key, true);
    store.completeActivation("run", token, key, null);
    const summary = summarizeUsage(second.listActivations("run"));
    assert.equal(summary.totalTokens, 17); assert.equal(summary.partial, false);
    assert.equal(summary.cacheRead, 10); assert.equal(summary.cacheReadPartial, true);
    assert.equal(summary.cacheWrite, 0); assert.equal(summary.cacheWriteReported, 1);
    assert.equal(summary.cost, 0.1); assert.equal(summary.costPartial, true);
    assert.equal(summary.reasoningReported, 0);
    const aggregate = parseUsage(second.getActivation("run", key)!.metadata.usage)!;
    assert.deepEqual(sumTokenUsage([aggregate, known]), sumTokenUsage([known, unknown, known]));
    assert.equal(parseUsage({ ...known, partialFields: ["reasoning"] }), undefined);
    assert.equal(parseUsage({ ...known, partialFields: ["input"] }), undefined);
  });
});

test("rejected usage leaves ledger, events and projections unchanged before and after accounting", async () => {
  for (const existing of [false, true]) await withStores((store, second, filename) => {
    create(store); const { token } = store.reserveLaunch("run");
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    const valid = { input: 1, output: 2, totalTokens: 3, cost: 0 };
    if (existing) {
      store.startUsage("run", token, key);
      store.recordUsage("run", token, key, "1", valid, "stop");
    }
    let calls = 0;
    const accessor = { ...valid };
    Object.defineProperty(accessor, "input", { get() { calls++; return 1; } });
    const indices = ["cost"];
    Object.defineProperty(indices, "0", { get() { calls++; return "cost"; } });
    const invalid = [accessor, Object.assign(Object.create({}), valid), { ...valid, partialFields: indices }, { ...valid, partialFields: new Array(1) }];
    const database = new DatabaseSync(filename);
    try {
      const snapshot = () => ({
        reports: second.usageReports("run"), events: second.events("run"),
        metadata: second.getActivation("run", key)!.metadata,
        summary: summarizeUsage(second.listActivations("run")),
        attempts: database.prepare("SELECT * FROM workflow_usage_attempts ORDER BY attempt").all(),
        ledger: database.prepare("SELECT * FROM workflow_usage_reports ORDER BY seq").all(),
      });
      const before = snapshot();
      for (const value of invalid) {
        assert.throws(() => store.recordUsage("run", token, key, "2", value, "stop"), /Invalid worker usage report/);
        assert.deepEqual(snapshot(), before);
      }
      const linked = { ...valid, cost: undefined, partialFields: ["cost"] };
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, "cost");
      let linkedError: unknown;
      try {
        Object.defineProperty(Object.prototype, "cost", {
          configurable: true,
          get() { calls++; return 0; },
          set(_value: unknown) { calls++; },
        });
        try { store.recordUsage("run", token, key, "2", linked, "stop"); }
        catch (error) { linkedError = error; }
      } finally {
        if (previous) Object.defineProperty(Object.prototype, "cost", previous);
        else Reflect.deleteProperty(Object.prototype, "cost");
      }
      assert.ok(linkedError instanceof Error);
      assert.match(linkedError.message, /Invalid worker usage report/);
      assert.equal(calls, 0);
      assert.deepEqual(snapshot(), before);
      store.recordUsage("run", token, key, "2", valid, "stop");
      store.recordUsage("run", token, key, "2", valid, "stop");
      assert.equal(second.usageReports("run").reports.length, before.reports.reports.length + 1);
      assert.equal(second.events("run").filter(event => event.type === "usage.reported").length, Number(existing) + 1);
      assert.equal(summarizeUsage(second.listActivations("run")).totalTokens, 3 * (Number(existing) + 1));
    } finally { database.close(); }
  });
});

test("response accounting persists before completion, deduplicates delivery and survives failed output", async () => {
  await withStores(async (store, second, filename) => {
    create(store);
    const { token } = store.reserveLaunch("run");
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    store.startUsage("run", token, key);
    const usage = { input: 10, output: 4, cacheRead: 30, cacheWrite: 0, reasoning: 2, totalTokens: 44, cost: 0.02 };
    store.recordUsage("run", token, key, "1", usage, "toolUse");
    store.recordUsage("run", token, key, "1", usage, "toolUse");
    assert.equal(second.usageReports("run").reports.length, 1);
    assert.equal(second.events("run").filter(event => event.type === "usage.reported").length, 1);
    assert.equal(summarizeUsage(second.listActivations("run")).totalTokens, 44);
    assert.equal(summarizeUsage(second.listActivations("run")).partial, true);
    assert.throws(() => store.recordUsage("run", token, key, "1", { ...usage, totalTokens: 45 }, "toolUse"), /Conflicting/);
    assert.throws(() => store.recordUsage("run", "stale-owner", key, "2", usage, "stop"), /Stale/);
    store.recordUsage("run", token, key, "2", usage, "stop");
    store.settleUsage("run", token, key, true);
    store.failActivation("run", token, key, "Invalid final result schema");
    store.finish("run", token, { status: "failed", error: "Invalid final result schema" });
    const summary = summarizeUsage(second.listActivations("run"));
    assert.equal(summary.totalTokens, 88); assert.equal(summary.reasoning, 4); assert.equal(summary.cacheRead, 60);
    assert.equal(summary.partial, false); // Task failed; accounting is complete.
    const service = new WorkflowService(filename);
    try {
      const page = await service.dispatch("run.usage", { id: "run", limit: 1 }) as any;
      assert.equal(page.reports.length, 1); assert.equal(page.hasMore, true);
      const next = await service.dispatch("run.usage", { id: "run", after: page.nextAfter, limit: 1 }) as any;
      assert.equal(next.reports[0].reportId, "2"); assert.equal(next.hasMore, false);
      assert.doesNotMatch(JSON.stringify(page), new RegExp(token));
      await assert.rejects(service.dispatch("run.usage", { id: "run", limit: 0 }), /limit/);
      await assert.rejects(service.dispatch("run.usage", { id: "missing" }), /not found/);
    } finally { service.close(); }
  });
});

test("unknown final response after cancellation remains partial with known tokens preserved", async () => {
  await withStores((store, second) => {
    create(store); const { token } = store.reserveLaunch("run");
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    store.startUsage("run", token, key);
    store.recordUsage("run", token, key, "1", { input: 7, output: 2, totalTokens: 9 }, "toolUse");
    store.requestControl("run", "cancel");
    store.settleUsage("run", token, key, false);
    store.failActivation("run", token, key, "cancelled");
    store.finish("run", token, { status: "cancelled" });
    const total = summarizeUsage(second.listActivations("run"));
    assert.equal(total.totalTokens, 9); assert.equal(total.partial, true); assert.equal(total.cacheReported, 0);
  });
});

test("response IDs are scoped to attempts and completed accounting from a prior attempt is retained", async () => {
  await withStores((store, second) => {
    create(store); const { token } = store.reserveLaunch("run");
    // Model the safe-retry admission boundary; writing agents still require explicit authorization.
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: false });
    store.startUsage("run", token, key);
    store.recordUsage("run", token, key, "1", { input: 7, output: 2, totalTokens: 9 }, "stop");
    store.settleUsage("run", token, key, true);
    store.markInterrupted("run", token, "Verified supervisor exit after response");
    const next = store.reserveLaunch("run").token;
    store.beginActivation("run", next, context, { kind: "agent", sideEffect: false });
    store.startUsage("run", next, key);
    assert.equal(summarizeUsage(second.listActivations("run")).totalTokens, 9);
    assert.equal(summarizeUsage(second.listActivations("run")).partial, true);
    store.recordUsage("run", next, key, "1", { input: 3, output: 2, totalTokens: 5 }, "stop");
    store.settleUsage("run", next, key, true);
    store.completeActivation("run", next, key, { result: true });
    const summary = summarizeUsage(second.listActivations("run"));
    assert.equal(summary.totalTokens, 14); assert.equal(summary.partial, false); assert.equal(summary.earlierAttempts, 0);
    assert.deepEqual(second.usageReports("run").reports.map(report => [report.attempt, report.reportId]), [[1, "1"], [2, "1"]]);
  });
});

test("usage report and aggregate roll back if durable event insertion fails", async () => {
  await withStores((store, second, filename) => {
    create(store); const { token } = store.reserveLaunch("run");
    store.beginActivation("run", token, context, { kind: "agent", sideEffect: true });
    store.startUsage("run", token, key);
    const database = new DatabaseSync(filename);
    try { database.exec("CREATE TRIGGER reject_usage BEFORE INSERT ON workflow_run_events WHEN NEW.type='usage.reported' BEGIN SELECT RAISE(ABORT,'audit write failure'); END;"); }
    finally { database.close(); }
    assert.throws(() => store.recordUsage("run", token, key, "1", { input: 1, output: 2, totalTokens: 3 }, "stop"), /audit write failure/);
    assert.equal(second.usageReports("run").reports.length, 0);
    assert.equal(second.getActivation("run", key)?.metadata.usage, undefined);
  });
});

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
