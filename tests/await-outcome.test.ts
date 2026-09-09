import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { WorkflowService } from "../src/service.js";
import { PresetLibrary } from "../src/presets.js";
import { validateWorkflow, type Expr, type Node, type WorkflowDefinition } from "../src/graph.js";
import { verifyExecutionPlan } from "../src/execution-plan.js";
import { fileURLToPath } from "node:url";
import { startGraphServer } from "../src/graph-view/server.js";
import { graphSnapshot } from "../src/graph-view/model.js";
import { renderDashboard } from "../src/monitor.js";

test("a v1 plan generated before this change retains its bytes/hash and executes on the v2 runtime", { timeout: 20_000 }, async () => {
  await fixture(async (c, directory) => {
    const saved = JSON.parse(await readFile(new URL("./fixtures/legacy-v1-plan.json", import.meta.url), "utf8"));
    const verified = verifyExecutionPlan(saved);
    assert.equal(verified.hash, saved.hash); assert.equal(verified.source, saved.source);
    const run = await c.startPrepared(verified, null, directory);
    const result = await waitFor(c, run.id, "succeeded");
    assert.equal(result.taskOutcome?.decision, "accepted"); assert.equal(result.taskOutcome?.source, "legacy");
    assert.deepEqual(result.output, { accepted: true, result: "legacy" });
  });
});

const literal = (value: any): Expr => ({ op: "literal", value });
const responseSchema = { type: "object", properties: { allow: { type: "boolean" } }, required: ["allow"], additionalProperties: false };
const waitNode: Node = { id: "answer", kind: "await", reason: literal("Нужны недостающие данные"), input: { op: "ref", path: ["input"] }, responseSchema };
const done = (decision: "accepted" | "rejected" | "inconclusive", id = "done"): Node => ({ id, kind: "finish", decision, reason: literal(`Task ${decision}`), evidence: literal([{ check: "before" }]), value: literal({ result: "artifact" }) });
function flow(nodes: Node[]): WorkflowDefinition {
  return { schemaVersion: 1, id: "wait_test", name: "Durable wait test", revision: 1, entryGraph: "main", graphs: {
    main: { entry: nodes[0]!.id, nodes, edges: nodes.slice(1).map((node, i) => ({ from: nodes[i]!.id, to: node.id })) },
  } };
}
async function until<T>(read: () => T, accepts: (value: T) => boolean, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = read(); if (accepts(value)) return value; await sleep(30); }
  throw new Error("Timed out waiting for durable workflow state");
}
async function fixture(work: (c: RunController, directory: string, filename: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-await-")), filename = join(directory, "state.sqlite");
  const c = new RunController(filename);
  try { await work(c, directory, filename); }
  finally {
    for (const run of c.store.listRuns()) {
      await c.control(run.id, "cancel");
      await until(() => c.observe(run.id), s => ["cancelled", "failed", "succeeded"].includes(s.run.status) && !s.workersAlive);
    }
    c.close(); await rm(directory, { recursive: true, force: true });
  }
}
const waitFor = (c: RunController, id: string, status: string) => until(() => c.observe(id).run, r => {
  if (r.status === "failed" && status !== "failed") throw new Error(r.error);
  return r.status === status;
});

test("finish persists declared outcome independently of output; only accepted tasks become tested presets", { timeout: 30_000 }, async () => {
  await fixture(async (c, directory) => {
    const library = new PresetLibrary(join(directory, "presets"));
    for (const decision of ["accepted", "rejected", "inconclusive"] as const) {
      const run = await c.start(flow([done(decision)]), null, directory);
      const result = await waitFor(c, run.id, "succeeded");
      assert.equal(result.taskOutcome?.decision, decision); assert.equal(result.taskOutcome?.source, "explicit");
      assert.deepEqual(result.output, { result: "artifact" });
      assert.deepEqual(result.taskOutcome?.evidence, [{ check: "before" }]);
      if (decision === "accepted") await library.save("accepted", result);
      else await assert.rejects(library.save(decision, result), /accepted task outcome/);
    }
    for (const output of [{ accepted: false }, { arbitrary: true }]) {
      const run = await c.start(flow([{ id: "end", kind: "end", value: literal(output) }]), null, directory);
      const result = await waitFor(c, run.id, "succeeded");
      assert.equal(result.taskOutcome?.source, "legacy");
      await assert.rejects(library.save("legacy", result), /accepted task outcome/);
    }
  });
});

test("await survives supervisor death and service replacement; resolving resumes without repeating checks", { timeout: 35_000 }, async () => {
  await fixture(async (c, directory, filename) => {
    const before: Node = { id: "before", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').appendFileSync('count','1')"] };
    const run = await c.start(flow([before, waitNode, done("accepted")]), { criteria: "evidence" }, directory);
    const waiting = await waitFor(c, run.id, "waiting");
    const request = c.store.waits(run.id)[0]!;
    assert.equal(request.status, "open"); assert.deepEqual(request.input, { criteria: "evidence" });
    process.kill(waiting.supervisorPid!, "SIGKILL");
    // Watch is the first observer after the crash; it must not report stale running/waiting.
    const watched = execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/watch.ts", import.meta.url)),
      "--run", run.id, "--store", filename, "--once"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(watched, /ПРЕРВАН/);
    assert.equal(c.store.get(run.id).status, "interrupted");
    const service = new WorkflowService(filename);
    try {
      await assert.rejects(service.dispatch("run.resolve", { id: run.id, waitId: request.id, response: { allow: "yes" } }), /allow must be boolean/);
      assert.equal(c.store.getWait(run.id, request.id).status, "open");
      await service.dispatch("run.resolve", { id: run.id, waitId: request.id, response: { allow: true }, resolvedBy: "test-agent" });
      const result = await waitFor(c, run.id, "succeeded");
      assert.equal(result.taskOutcome?.decision, "accepted");
      assert.equal(await readFile(join(directory, "count"), "utf8"), "1");
      assert.equal(c.store.waits(run.id).length, 1);
      assert.equal(c.store.getWait(run.id, request.id).resolvedBy, "test-agent");
      await service.dispatch("run.resolve", { id: run.id, waitId: request.id, response: { allow: true } });
      assert.equal(c.store.events(run.id).filter(e => e.type === "wait.resolved").length, 1);
      await assert.rejects(service.dispatch("run.resolve", { id: run.id, waitId: request.id, response: { allow: false } }), /different response/);
    } finally { service.close(); }
  });
});

test("answering a paused wait preserves operator pause; resume consumes the answer", { timeout: 30_000 }, async () => {
  await fixture(async (c, directory) => {
    const run = await c.start(flow([waitNode, done("rejected")]), null, directory);
    await waitFor(c, run.id, "waiting");
    const request = c.store.waits(run.id)[0]!;
    await c.control(run.id, "pause"); await waitFor(c, run.id, "paused");
    await c.resolve(run.id, request.id, { allow: false });
    await sleep(200);
    assert.equal(c.store.get(run.id).status, "paused");
    assert.equal(c.store.listActivations(run.id).some(a => a.kind === "finish"), false);
    await c.control(run.id, "resume");
    assert.equal((await waitFor(c, run.id, "succeeded")).taskOutcome?.decision, "rejected");
  });
});

test("fan-out waits resolve independently and cancellation prevents further resolutions", { timeout: 30_000 }, async () => {
  await fixture(async (c, directory) => {
    const workflow = flow([{ id: "fan", kind: "map", graphId: "child", items: literal(["first", "second"]) }, done("accepted")]);
    workflow.graphs.child = flow([waitNode, { id: "end", kind: "end", value: { op: "ref", path: ["nodes", "answer"] } }]).graphs.main!;
    const run = await c.start(workflow, null, directory);
    await until(() => c.store.waits(run.id), w => w.length === 2);
    await waitFor(c, run.id, "waiting");
    const [first, second] = c.store.waits(run.id);
    assert.notEqual(first!.key, second!.key);
    await c.resolve(run.id, first!.id, { allow: true });
    await until(() => c.store.listActivations(run.id), a => a.some(x => x.kind === "await" && x.status === "succeeded"));
    await waitFor(c, run.id, "waiting");
    assert.equal(c.store.getWait(run.id, second!.id).status, "open");
    await c.control(run.id, "cancel"); await waitFor(c, run.id, "cancelled");
    await assert.rejects(c.resolve(run.id, second!.id, { allow: true }), /ended or cancelling/);
  });
});

test("worktree children phase reattaches around a durable wait and preserves completed writes", { timeout: 45_000 }, async () => {
  await fixture(async (c, directory) => {
    const repo = join(directory, "repo"); await mkdir(repo);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init"); await writeFile(join(repo, "README"), "fixture\n"); git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-m", "initial");
    const head = git("rev-parse", "HEAD");
    const workflow = flow([{ id: "candidate", kind: "worktree", graphId: "child", input: literal(null) }, done("accepted")]);
    workflow.graphs.child = flow([
      { id: "before", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').appendFileSync('made.txt','once\\n')"] },
      waitNode, { id: "end", kind: "end", value: literal("ready") },
    ]).graphs.main!;
    const run = await c.start(workflow, null, repo);
    const waiting = await waitFor(c, run.id, "waiting");
    const workspace = c.store.listActivations(run.id).find(a => a.kind === "worktree")!.metadata.workspace as { path: string };
    const request = c.store.waits(run.id)[0]!;
    process.kill(waiting.supervisorPid!, "SIGKILL"); await waitFor(c, run.id, "interrupted");
    await c.resolve(run.id, request.id, { allow: true }); await waitFor(c, run.id, "succeeded");
    const parent = c.store.listActivations(run.id).find(a => a.kind === "worktree")!;
    assert.equal(parent.attempt, 2); assert.equal((parent.metadata.workspace as any).path, workspace.path);
    assert.equal(await readFile(join(workspace.path, "made.txt"), "utf8"), "once\n");
    assert.equal(git("rev-parse", "HEAD"), head);
  });
});

test("an open wait does not stop another branch and only idle leaves make the run waiting", { timeout: 25_000 }, async () => {
  await fixture(async (c, directory) => {
    const workflow = flow([{ id: "fan", kind: "parallel", children: ["question", "work"].map(graphId => ({ id: graphId, graphId, input: literal(null) })) }, done("accepted")]);
    workflow.graphs.question = flow([waitNode, { id: "end", kind: "end", value: literal(null) }]).graphs.main!;
    workflow.graphs.work = flow([{ id: "check", kind: "check", command: process.execPath, args: ["-e", "const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync('release'))clearInterval(t)},25)"] }, { id: "end", kind: "end", value: literal(null) }]).graphs.main!;
    const run = await c.start(workflow, null, directory);
    await until(() => c.store.listActivations(run.id), a => a.some(x => x.kind === "check" && typeof x.metadata.workerPid === "number") && c.store.waits(run.id).length === 1);
    assert.equal(c.observe(run.id).run.status, "running");
    const snapshot = graphSnapshot(c.store.get(run.id), c.store.listActivations(run.id), new Map(), c.store.waits(run.id));
    assert.equal(snapshot.activeKeys.length, 1);
    await writeFile(join(directory, "release"), "done");
    await waitFor(c, run.id, "waiting");
    assert.equal(c.store.listActivations(run.id).find(a => a.kind === "check")!.status, "succeeded");
    await c.resolve(run.id, c.store.waits(run.id)[0]!.id, { allow: true });
    await waitFor(c, run.id, "succeeded");
  });
});

test("await schema and finish topology are validated before execution", () => {
  const invalid = flow([{ ...waitNode, responseSchema: { type: "not-a-json-type" } } as Node, done("accepted")]);
  assert.equal(validateWorkflow(invalid).valid, false);
  const invalidEdge = flow([done("accepted"), { id: "end", kind: "end", value: literal(null) }]);
  assert.equal(validateWorkflow(invalidEdge).valid, false);
});

test("root explicit outcome wins over child decisions and legacy-looking output in every projection", { timeout: 20_000 }, async () => {
  await fixture(async (c, directory) => {
    const workflow = flow([{ id: "child", kind: "subworkflow", graphId: "child", input: literal(null) },
      { ...done("accepted"), value: literal({ accepted: false }) } as Node]);
    workflow.graphs.child = flow([done("rejected")]).graphs.main!;
    const run = await c.start(workflow, null, directory);
    const result = await waitFor(c, run.id, "succeeded"), records = c.store.listActivations(run.id);
    assert.equal(result.taskOutcome?.decision, "accepted");
    assert.equal(graphSnapshot(result, records).accepted, true);
    assert.doesNotMatch(renderDashboard(result, records, { width: 200, height: 40 }), /РЕЗУЛЬТАТ НЕ ПРИНЯТ/);
    const invalid = await c.start(flow([{ ...done("accepted"), reason: literal(" ") } as Node]), null, directory);
    assert.match((await waitFor(c, invalid.id, "failed")).error!, /nonempty reason/);
    assert.equal(c.store.get(invalid.id).taskOutcome, undefined);
  });
});

test("browser resolves the frozen contract, rejects foreign origin and malformed responses, then follows the selected decision", { timeout: 30_000 }, async () => {
  await fixture(async (c, directory, filename) => {
    const workflow = flow([waitNode, done("accepted", "yes"), done("rejected", "no")]);
    workflow.graphs.main!.edges = [
      { from: "answer", to: "yes", when: { op: "ref", path: ["nodes", "answer", "allow"] } },
      { from: "answer", to: "no" },
    ];
    const run = await c.start(workflow, null, directory);
    await waitFor(c, run.id, "waiting");
    const server = await startGraphServer(filename, run.id);
    const headers = { Origin: new URL(server.url).origin, "Content-Type": "application/json", "X-Dynamicwf-View": "1" };
    const snapshot = async () => await (await fetch(`${server.url}snapshot`)).json() as any;
    try {
      const state = await snapshot(), wait = state.waits[0];
      assert.equal(state.status, "waiting"); assert.deepEqual(state.activeKeys, []);
      assert.equal(state.presentation.liveness.state, "supervised");
      assert.equal(state.presentation.waitingKeys.length, 1);
      const service = new WorkflowService(filename);
      try {
        const status = await service.dispatch("run.status", { id: run.id }) as any;
        const normalized = (p: any) => ({ ...p, liveness: { ...p.liveness, observedAt: null } });
        assert.deepEqual(normalized(status.presentation), normalized(state.presentation));
        const list = await (await fetch(`${server.url}runs`)).json() as any;
        assert.deepEqual(normalized(list.runs[0].presentation), normalized(state.presentation));
      } finally { service.close(); }
      assert.equal(state.graphs[0].nodes[0].status, "waiting");
      assert.deepEqual(wait.responseSchema, responseSchema);
      const post = (response: unknown, h = headers, extra = {}) => fetch(`${server.url}resolve`, {
        method: "POST", headers: h, body: JSON.stringify({ id: run.id, waitId: wait.id, response, ...extra }),
      });
      assert.equal((await post({ allow: true }, { ...headers, Origin: "https://foreign.invalid" })).status, 403);
      assert.equal((await post({ allow: "yes" })).status, 400);
      assert.equal((await post({ allow: true, unexpected: true })).status, 400);
      assert.equal((await post({ allow: true }, headers, { resolvedBy: "spoofed" })).status, 400);
      assert.equal(c.store.getWait(run.id, wait.id).status, "open");
      assert.equal((await post({ allow: false })).status, 200);
      await waitFor(c, run.id, "succeeded");
      const final = await snapshot();
      assert.equal(final.taskOutcome.decision, "rejected"); assert.equal(final.accepted, false);
      assert.equal(final.waits[0].resolvedBy, "browser");
      assert.equal(final.graphs[0].nodes.find((n: any) => n.id === "yes").status, "unvisited");
      assert.equal((await post({ allow: false })).status, 200);
      assert.equal((await post({ allow: true })).status, 400);
      assert.equal(c.store.events(run.id).filter(e => e.type === "wait.resolved").length, 1);
    } finally { await server.close(); }
  });
});
