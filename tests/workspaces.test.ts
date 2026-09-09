import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { RunStore } from "../src/run-store.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { loadGeneratedModule } from "../src/generated-module.js";
import { GitWorkspaces, assertParallelWriterIsolation, type WorkspaceRecord } from "../src/workspaces.js";
import { prepareExecutionPlan, verifyExecutionPlan } from "../src/execution-plan.js";
import { RunController } from "../src/run-controller.js";
import type { RunRecord } from "../src/run-store.js";
import type { Expr, Graph, Node, WorkflowDefinition } from "../src/graph.js";

const literal = (value: any): Expr => ({ op: "literal", value });
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const graph = (nodes: Node[]): Graph => ({ entry: nodes[0]!.id, nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) });
const end = (value: Expr = ref("input")): Node => ({ id: "done", kind: "end", value });
function git(cwd: string, ...args: string[]): string { return execFileSync("git", ["-c", "user.name=Test Identity", "-c", "user.email=test@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-workspaces-")));
  const repo = join(directory, "repo"); await mkdir(repo);
  git(repo, "init", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "Initial fixture");
  return { directory, repo, base: git(repo, "rev-parse", "HEAD") };
}
function workflow(graphs: Record<string, Graph>): WorkflowDefinition { return { schemaVersion: 1, id: "isolation", name: "Git isolation", revision: 1, entryGraph: "main", graphs }; }
async function waitRun(controller: RunController, id: string, condition: (run: RunRecord) => boolean): Promise<RunRecord> {
  const deadline = Date.now() + 45_000;
  let latest: RunRecord;
  for (;;) {
    latest = controller.observe(id).run;
    if (condition(latest)) return latest;
    if (["failed", "cancelled", "interrupted"].includes(latest.status)) assert.fail(`Unexpected run state: ${latest.status}: ${latest.error}`);
    if (Date.now() > deadline) assert.fail(`Run wait expired: ${latest.status}: ${latest.error}`);
    await sleep(40);
  }
}
async function cleanup(controller: RunController, id: string | undefined) {
  if (id) {
    await controller.control(id, "cancel");
    const deadline = Date.now() + 15_000;
    for (;;) {
      const state = controller.observe(id);
      if (["cancelled", "succeeded", "failed"].includes(state.run.status) && state.workersAlive === 0) break;
      if (Date.now() > deadline) assert.fail("Workspace test cleanup did not drain workers");
      await sleep(50);
    }
  }
  controller.close();
}
function isolatedFlow(command: string): WorkflowDefinition {
  return workflow({
    main: graph([{ id: "allocate", kind: "worktree", graphId: "worker", input: ref("input") }, end(ref("nodes", "allocate"))]),
    worker: graph([{ id: "edit", kind: "check", command: process.execPath, args: ["-e", command] }, end(ref("nodes", "edit"))]),
  });
}

test("worktrees preserve branch changes and use task-local commit identity; dirty roots are rejected", async () => {
  const f = await fixture();
  try {
    git(f.repo, "config", "user.name", "Original Local Identity");
    const manager = new GitWorkspaces("run-direct", join(f.directory, "run"));
    await writeFile(join(f.repo, "untracked.txt"), "user content");
    await assert.rejects(manager.allocate(f.repo, "first", undefined), /must be clean/);
    assert.equal(await readFile(join(f.repo, "untracked.txt"), "utf8"), "user content");
    await rm(join(f.repo, "untracked.txt"));
    await assert.rejects(manager.allocate(f.repo, "bad-base", "--help"), /git rev-parse failed/);
    const allocated = await manager.allocate(f.repo, "first", undefined);
    assert.equal(allocated.base, f.base);
    await writeFile(join(allocated.path, "feature.txt"), "isolated change\n");
    const committed = await manager.commit(allocated);
    assert.notEqual(committed.head, f.base);
    assert.equal(git(allocated.path, "log", "-1", "--format=%an <%ae>"), "Dynamic Workflow <dynamicwf@localhost>");
    assert.equal(git(f.repo, "config", "--local", "user.name"), "Original Local Identity");
    assert.equal(git(f.repo, "rev-parse", "HEAD"), f.base);
    await assert.rejects(readFile(join(f.repo, "feature.txt")), /ENOENT/);
    assert.equal(git(allocated.path, "status", "--porcelain"), "");
    assert.equal((await manager.commit(allocated)).head, committed.head, "no empty commit for unchanged workspace");
    await assert.rejects(manager.integrate(f.repo, [committed as unknown as any], []), /not a completed workspace/);
    await writeFile(join(allocated.path, "later.txt"), "new change");
    await manager.commit(allocated);
    await assert.rejects(manager.integrate(f.repo, [committed as unknown as any], [committed]), /head changed/);
    assert.equal(git(f.repo, "rev-parse", "HEAD"), f.base);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("reattach preserves dirty files but refuses different owners, paths, repositories and branches", async () => {
  const f = await fixture(), other = await fixture();
  try {
    const manager = new GitWorkspaces("run-reattach", join(f.directory, "run"));
    const allocation = await manager.allocate(f.repo, "child", undefined);
    await writeFile(join(allocation.path, "pending.txt"), "preserve me");
    assert.deepEqual(await manager.reattach(f.repo, "child", { ...allocation }), allocation);
    await assert.rejects(manager.reattach(f.repo, "other-child", { ...allocation }), /different activation/);
    await assert.rejects(manager.reattach(f.repo, "child", { ...allocation, path: f.repo }), /does not belong/);
    await assert.rejects(manager.reattach(other.repo, "child", { ...allocation }), /different repository/);
    git(allocation.path, "checkout", "-b", "externally-changed");
    await assert.rejects(manager.reattach(f.repo, "child", { ...allocation }), /branch changed/);
    assert.equal(await readFile(join(allocation.path, "pending.txt"), "utf8"), "preserve me");
    assert.equal(git(f.repo, "rev-parse", "HEAD"), f.base);
  } finally { await rm(f.directory, { recursive: true, force: true }); await rm(other.directory, { recursive: true, force: true }); }
});

test("real parallel child graphs edit separate worktrees and explicit integration merges both", async () => {
  const f = await fixture();
  const controller = new RunController(join(f.directory, "state.sqlite"));
  let id: string | undefined;
  try {
    const graphs: Record<string, Graph> = {
      main: graph([
        { id: "fan", kind: "parallel", children: ["left", "right"].map(name => ({ id: name, graphId: name, input: literal(name) })) },
        { id: "merge", kind: "integrate", sources: { op: "array", items: [ref("nodes", "fan", "left"), ref("nodes", "fan", "right")] } },
        end(ref("nodes", "merge")),
      ]),
    };
    for (const name of ["left", "right"]) {
      graphs[name] = graph([{ id: "allocate", kind: "worktree", graphId: `${name}Writer`, input: ref("input") }, end(ref("nodes", "allocate"))]);
      graphs[`${name}Writer`] = graph([{ id: "edit", kind: "check", command: process.execPath, args: ["-e", `require('node:fs').writeFileSync('${name}.txt', '${name}'); process.stdout.write(process.cwd())`] }, end(ref("nodes", "edit"))]);
    }
    id = (await controller.start(workflow(graphs), null, f.repo, { availableModels: [] })).id;
    const finished = await waitRun(controller, id, run => run.status === "succeeded");
    assert.equal(await readFile(join(f.repo, "left.txt"), "utf8"), "left");
    assert.equal(await readFile(join(f.repo, "right.txt"), "utf8"), "right");
    assert.equal(git(f.repo, "status", "--porcelain"), "");
    const worktrees = controller.store.listActivations(id).filter(item => item.kind === "worktree");
    assert.equal(worktrees.length, 2);
    const records = worktrees.map(item => (item.output as any).workspace as WorkspaceRecord);
    assert.notEqual(records[0]!.path, records[1]!.path);
    for (const [index, activation] of worktrees.entries()) {
      assert.equal((activation.output as any).result.stdout, records[index]!.path);
      assert.equal(git(records[index]!.path, "rev-parse", "HEAD"), records[index]!.head);
      assert.equal(records[index]!.base, f.base);
      assert.equal(activation.sideEffect, true);
    }
    assert.equal((finished.output as any).workspace.head, git(f.repo, "rev-parse", "HEAD"));
    assert.equal((finished.output as any).merged.length, 2);
    assert.equal(controller.store.listActivations(id).find(item => item.kind === "integrate")!.sideEffect, true);
  } finally { await cleanup(controller, id); await rm(f.directory, { recursive: true, force: true }); }
});

test("conflicting integration aborts only its merge and preserves earlier committed integration", async () => {
  const f = await fixture();
  try {
    const manager = new GitWorkspaces("run-conflict", join(f.directory, "run"));
    const left = await manager.allocate(f.repo, "left", undefined);
    const right = await manager.allocate(f.repo, "right", undefined);
    await writeFile(join(left.path, "base.txt"), "left\n");
    await writeFile(join(right.path, "base.txt"), "right\n");
    const a = await manager.commit(left), b = await manager.commit(right);
    await assert.rejects(manager.integrate(f.repo, [a, b] as any, [a, b]), /Integration failed/);
    assert.equal(await readFile(join(f.repo, "base.txt"), "utf8"), "left\n");
    assert.equal(git(f.repo, "status", "--porcelain"), "");
    assert.throws(() => git(f.repo, "rev-parse", "--verify", "MERGE_HEAD"));
    assert.equal(git(left.path, "rev-parse", "HEAD"), a.head);
    assert.equal(git(right.path, "rev-parse", "HEAD"), b.head);
    await writeFile(join(f.repo, "local.txt"), "user content");
    await assert.rejects(manager.integrate(f.repo, [a] as any, [a]), /must be clean/);
    assert.equal(await readFile(join(f.repo, "local.txt"), "utf8"), "user content");
    await rm(join(f.repo, "local.txt"));
    git(f.repo, "checkout", "--detach");
    await assert.rejects(manager.integrate(f.repo, [a] as any, [a]), /detached HEAD/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("pause drains a child before commit, preserves scoped workspace, then resume commits", async () => {
  const f = await fixture();
  const controller = new RunController(join(f.directory, "state.sqlite"));
  let id: string | undefined;
  try {
    id = (await controller.start(isolatedFlow("require('node:fs').writeFileSync('paused.txt','kept'); setTimeout(()=>{},800)"), null, f.repo, { availableModels: [] })).id;
    await waitRun(controller, id, () => controller.store.listActivations(id!).some(item => item.kind === "check" && typeof item.metadata.workerPid === "number"));
    await controller.control(id, "pause");
    await waitRun(controller, id, run => run.status === "paused");
    const allocation = controller.store.listActivations(id).find(item => item.kind === "worktree")!;
    const workspace = allocation.metadata.workspace as any;
    assert.equal(allocation.status, "running");
    assert.equal(allocation.metadata.workspacePhase, "children");
    assert.equal(await readFile(join(workspace.path, "paused.txt"), "utf8"), "kept");
    assert.equal(git(workspace.path, "rev-parse", "HEAD"), f.base);
    assert.equal(controller.observe(id).workersAlive, 0);
    await controller.control(id, "resume");
    const finished = await waitRun(controller, id, run => run.status === "succeeded");
    assert.notEqual((finished.output as any).workspace.head, f.base);
    assert.equal(git(f.repo, "rev-parse", "HEAD"), f.base);
  } finally { await cleanup(controller, id); await rm(f.directory, { recursive: true, force: true }); }
});

test("cancellation reaps child processes and retains uncommitted branch work without a success artifact", async () => {
  const f = await fixture();
  const controller = new RunController(join(f.directory, "state.sqlite"));
  let id: string | undefined;
  try {
    id = (await controller.start(isolatedFlow("const fs=require('node:fs'); fs.writeFileSync('pending.txt','retained'); fs.writeFileSync('child.pid',String(process.pid)); setInterval(()=>{},1000)"), null, f.repo, { availableModels: [] })).id;
    let path: string | undefined;
    const deadline = Date.now() + 30_000;
    while (!path) {
      controller.observe(id);
      const allocation = controller.store.listActivations(id).find(item => item.kind === "worktree");
      const candidate = (allocation?.metadata.workspace as any)?.path;
      if (candidate) { try { await stat(join(candidate, "child.pid")); path = candidate; } catch {} }
      if (Date.now() > deadline) assert.fail("Child never became active");
      await sleep(40);
    }
    const childPid = Number(await readFile(join(path, "child.pid"), "utf8"));
    await controller.control(id, "cancel");
    const cancelled = await waitRun(controller, id, run => run.status === "cancelled");
    assert.equal(cancelled.output, undefined);
    assert.equal(await readFile(join(path, "pending.txt"), "utf8"), "retained");
    assert.equal(git(path, "rev-parse", "HEAD"), f.base);
    assert.equal(controller.store.listActivations(id).find(item => item.kind === "worktree")!.output, undefined);
    assert.equal(controller.observe(id).workersAlive, 0);
    assert.throws(() => process.kill(childPid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  } finally { await cleanup(controller, id); await rm(f.directory, { recursive: true, force: true }); }
});

function parallelWriter(isolate: boolean, concurrency?: number): WorkflowDefinition {
  return workflow({
    main: graph([{ id: "fan", kind: "map", graphId: isolate ? "isolated" : "worker", items: literal([1, 2]), ...(concurrency ? { concurrency } : {}) }, end(ref("nodes", "fan"))]),
    ...(isolate ? { isolated: graph([{ id: "branch", kind: "worktree", graphId: "worker", input: ref("input") }, end(ref("nodes", "branch"))]) } : {}),
    worker: graph([{ id: "writer", kind: "agent", role: "implementer", task: literal("Implement assigned change") }, end(ref("nodes", "writer"))]),
  });
}
test("parallel writer policy requires isolation per fan-out, also for nested forks and tampered frozen permissions", async () => {
  assert.throws(() => assertParallelWriterIsolation(parallelWriter(false)), /Parallel writer/);
  assert.doesNotThrow(() => assertParallelWriterIsolation(parallelWriter(true)));
  assert.doesNotThrow(() => assertParallelWriterIsolation(parallelWriter(false, 1)));
  await assert.rejects(prepareExecutionPlan(parallelWriter(false), { cwd: process.cwd(), availableModels: [] }), /Parallel writer/);
  const nested = parallelWriter(true);
  nested.graphs.isolated!.nodes[0] = { id: "branch", kind: "worktree", graphId: "inner", input: ref("input") };
  nested.graphs.inner = graph([{ id: "nested", kind: "map", graphId: "worker", items: literal([1, 2]) }, end(ref("nodes", "nested"))]);
  assert.throws(() => assertParallelWriterIsolation(nested), /Parallel writer/);
  const readOnly = parallelWriter(false);
  const agent = readOnly.graphs.worker!.nodes[0]!;
  if (agent.kind !== "agent") throw Error("test invariant");
  agent.role = "general";
  const plan = structuredClone(await prepareExecutionPlan(readOnly, { cwd: process.cwd(), availableModels: [{ provider: "test", id: "model", thinkingLevels: ["off"] }] }));
  plan.agents.worker!.writer!.permission = "workspace-write";
  function canonical(value: any): string { return value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
  const { hash: _, ...data } = plan;
  plan.hash = createHash("sha256").update(canonical(data)).digest("hex");
  assert.throws(() => verifyExecutionPlan(plan), /Parallel writer/);
});


test("a pause injected after the gate wins atomic commit admission until explicit resume", async () => {
  const f = await fixture();
  const directory = join(f.directory, "run");
  const store = new RunStore(join(f.directory, "state.sqlite"));
  try {
    const plan = await prepareExecutionPlan(isolatedFlow("require('node:fs').writeFileSync('atomic.txt','kept')"), { cwd: f.repo, availableModels: [] });
    store.create({ id: "run-atomic", plan, input: null, cwd: f.repo });
    const { token, run } = store.reserveLaunch("run-atomic");
    const original = store.admitWorkspaceCommit.bind(store);
    let injected = false;
    let refused = false;
    store.admitWorkspaceCommit = (id, owner, key) => {
      if (!injected) {
        injected = true;
        store.requestControl(id, "pause");
        store.markPaused(id, owner);
        refused = !original(id, owner, key);
        assert.equal(refused, true);
        assert.equal(store.getActivation(id, key)!.metadata.workspacePhase, "children");
        const allocation = store.getActivation(id, key)!.metadata.workspace as any;
        assert.equal(git(allocation.path, "rev-parse", "HEAD"), f.base);
        setTimeout(() => store.requestControl(id, "resume"), 40);
        return false;
      }
      assert.equal(store.get(id).desired, "running");
      return original(id, owner, key);
    };
    const module = await loadGeneratedModule(plan, directory);
    const output = await Effect.runPromise(module.run(new JournalRuntime(store, run, token, directory), null));
    store.finish(run.id, token, { status: "succeeded", output });
    assert.equal(injected, true); assert.equal(refused, true);
    assert.notEqual((output as any).workspace.head, f.base);
    const phases = store.events(run.id).filter(event => event.type === "activation.metadata").map(event => (event.payload as any).metadata.workspacePhase);
    assert.equal(phases.filter(phase => phase === "committing").length, 1);
  } finally { store.close(); await rm(f.directory, { recursive: true, force: true }); }
});


test("subdirectory sources fail before allocation and ignored target files are never overwritten", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, ".gitignore"), "ignored.txt\n");
    await mkdir(join(f.repo, "sub"));
    await writeFile(join(f.repo, "sub", "file.txt"), "subdirectory");
    git(f.repo, "add", "."); git(f.repo, "commit", "-m", "Ignore local content");
    await writeFile(join(f.repo, "ignored.txt"), "USER_LOCAL_IGNORED_CONTENT");
    const manager = new GitWorkspaces("run-preserve", join(f.directory, "run"));
    await assert.rejects(manager.allocate(join(f.repo, "sub"), "subdirectory", undefined), /repository root/);
    assert.equal(git(f.repo, "worktree", "list", "--porcelain").split("worktree ").length - 1, 1);
    const allocation = await manager.allocate(f.repo, "tracked", undefined);
    await writeFile(join(allocation.path, "ignored.txt"), "WORKER_CONTENT");
    git(allocation.path, "add", "--force", "ignored.txt");
    const record = await manager.commit(allocation);
    const before = git(f.repo, "rev-parse", "HEAD");
    await assert.rejects(manager.integrate(f.repo, [record] as any, [record]), /Integration failed/);
    assert.equal(await readFile(join(f.repo, "ignored.txt"), "utf8"), "USER_LOCAL_IGNORED_CONTENT");
    assert.equal(git(f.repo, "rev-parse", "HEAD"), before);
    assert.equal(git(f.repo, "status", "--porcelain"), "");
    await assert.rejects(manager.integrate(join(f.repo, "sub"), [record] as any, [record]), /repository root/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});


test("inherited Git index/repository/identity overrides fail before touching external state", async () => {
  const f = await fixture();
  const external = join(f.directory, "external-index");
  try {
    execFileSync("git", ["read-tree", "HEAD"], { cwd: f.repo, env: { ...process.env, GIT_INDEX_FILE: external } });
    const bytes = await readFile(external);
    const manager = new GitWorkspaces("run-environment", join(f.directory, "run"));
    for (const name of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_PARAMETERS", "GIT_AUTHOR_EMAIL"]) {
      const old = process.env[name];
      process.env[name] = external;
      try { await assert.rejects(manager.allocate(f.repo, name, undefined), error => error instanceof Error && error.message.includes(name) && !error.message.includes(external)); }
      finally { if (old === undefined) delete process.env[name]; else process.env[name] = old; }
    }
    assert.deepEqual(await readFile(external), bytes);
    assert.equal(git(f.repo, "worktree", "list", "--porcelain").split("worktree ").length - 1, 1);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});


test("ignored collision matching protects case variants on case-insensitive filesystems", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, ".gitignore"), "foo.txt\nFoo.txt\n");
    git(f.repo, "add", ".gitignore"); git(f.repo, "commit", "-m", "Ignore case variants");
    await writeFile(join(f.repo, "foo.txt"), "USER_LOCAL_CONTENT");
    const manager = new GitWorkspaces("run-casefold", join(f.directory, "run"));
    const allocation = await manager.allocate(f.repo, "case-variant", undefined);
    await writeFile(join(allocation.path, "Foo.txt"), "WORKER_CONTENT");
    git(allocation.path, "add", "--force", "Foo.txt");
    const record = await manager.commit(allocation);
    const before = git(f.repo, "rev-parse", "HEAD");
    await assert.rejects(manager.integrate(f.repo, [record] as any, [record]), /ignored local content/);
    assert.equal(await readFile(join(f.repo, "foo.txt"), "utf8"), "USER_LOCAL_CONTENT");
    assert.equal(git(f.repo, "rev-parse", "HEAD"), before);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
