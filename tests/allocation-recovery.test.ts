import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { GitWorkspaces, type WorkspaceAllocation } from "../src/workspaces.js";
import { RunController } from "../src/run-controller.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import type { Json, WorkflowDefinition } from "../src/graph.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function fixture(work: (root: string, repo: string, manager: GitWorkspaces) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-allocation-recovery-"))), repo = join(root, "repo"); await mkdir(repo);
  git(repo, "init", "-b", "main"); await writeFile(join(repo, "base"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  try { await work(root, repo, new GitWorkspaces("run-allocation", join(root, "run"))); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function intended(manager: GitWorkspaces, repo: string, key: string): Promise<WorkspaceAllocation> {
  let value!: WorkspaceAllocation;
  await assert.rejects(manager.allocate(repo, key, undefined, {}, allocation => { value = allocation; throw new Error("Stop after allocation intent"); }), /Stop after allocation intent/);
  return value;
}

test("allocation recovery handles intent-only, retained branch and exact missing registration without pruning siblings", { timeout: 30_000 }, async () => fixture(async (root, repo, manager) => {
  const other = await manager.allocate(repo, "unrelated", undefined); await rm(other.path, { recursive: true });
  for (const mode of ["create", "reuse-branch", "replace-registration"] as const) {
    const allocation = mode === "replace-registration" ? await manager.allocate(repo, mode, undefined) : await intended(manager, repo, mode);
    if (mode === "reuse-branch") git(repo, "branch", allocation.branch, allocation.base);
    if (mode === "replace-registration") await rm(allocation.path, { recursive: true });
    const inspected = await manager.inspectAllocationRecovery(repo, mode, { ...allocation }); assert.equal(inspected.mode, mode);
    const index = inspected.registration ? await readFile(join(inspected.registration, "index")) : null, events: Json[] = [];
    const restored = await manager.recoverAllocation(repo, mode, { ...allocation }, {}, event => events.push(event));
    assert.deepEqual(restored, allocation); assert.equal(await readFile(join(allocation.path, "base"), "utf8"), "base\n");
    assert.equal(git(allocation.path, "rev-parse", "HEAD"), allocation.base);
    assert.ok(git(repo, "worktree", "list", "--porcelain").includes(other.path));
    const archived = events.find(e => (e as Record<string, Json>).phase === "registration-archived") as Record<string, Json> | undefined;
    if (index) { assert.ok(archived); assert.deepEqual(await readFile(join(String(archived.archive), "registration", "index")), index); }
    else assert.equal(archived, undefined);
  }
}));

test("locked, moved-branch and advanced allocation registrations remain untouched", { timeout: 20_000 }, async () => fixture(async (_root, repo, manager) => {
  const locked = await manager.allocate(repo, "locked", undefined); git(repo, "worktree", "lock", "--reason", "User mount", locked.path); await rm(locked.path, { recursive: true });
  await assert.rejects(manager.inspectAllocationRecovery(repo, "locked", { ...locked }), /unlocked allocation/);
  const moved = await manager.allocate(repo, "moved", undefined), elsewhere = moved.path + "-elsewhere";
  git(repo, "worktree", "move", moved.path, elsewhere);
  await assert.rejects(manager.inspectAllocationRecovery(repo, "moved", { ...moved }), /another workspace/);
  const advanced = await manager.allocate(repo, "advanced", undefined); await writeFile(join(advanced.path, "new"), "preserve me"); git(advanced.path, "add", "."); git(advanced.path, "commit", "-m", "external change"); const head = git(advanced.path, "rev-parse", "HEAD"); await rm(advanced.path, { recursive: true });
  await assert.rejects(manager.inspectAllocationRecovery(repo, "advanced", { ...advanced }), /branch changed/);
  assert.equal(git(repo, "rev-parse", advanced.branch), head); assert.ok(git(repo, "worktree", "list", "--porcelain").includes("locked User mount"));
  assert.equal(await readFile(join(elsewhere, "base"), "utf8"), "base\n");
}));

test("checkpoint failures before removal and after removal preserve an archive and allow a fresh recovery", { timeout: 20_000 }, async () => fixture(async (_root, repo, manager) => {
  for (const phase of ["removing-registration", "registration-removed"]) {
    const allocation = await manager.allocate(repo, phase, undefined); await rm(allocation.path, { recursive: true });
    let archive = "";
    await assert.rejects(manager.recoverAllocation(repo, phase, { ...allocation }, {}, event => {
      const value = event as Record<string, Json>; if (typeof value.archive === "string") archive = value.archive;
      if (value.phase === phase) throw new Error("Rejected recovery checkpoint");
    }), /Rejected recovery checkpoint/);
    await access(join(archive, "registration", "HEAD"));
    assert.equal((await manager.inspectAllocationRecovery(repo, phase, { ...allocation })).mode, phase === "removing-registration" ? "replace-registration" : "reuse-branch");
    await manager.recoverAllocation(repo, phase, { ...allocation }, {}, () => {});
    assert.equal(await readFile(join(allocation.path, "base"), "utf8"), "base\n");
  }
}));

test("a journaled allocation gap resumes the same run and executes its child once", { timeout: 30_000 }, async () => fixture(async (root, repo) => {
  const controller = new RunController(join(root, "state.sqlite")), id = "run-allocation";
  try {
    const workflow: WorkflowDefinition = { schemaVersion: 1, id: "allocation", name: "Allocation recovery", revision: 1, entryGraph: "main", graphs: {
      main: { entry: "work", nodes: [{ id: "work", kind: "worktree", graphId: "child", input: { op: "literal", value: null } }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } }], edges: [{ from: "work", to: "done" }] },
      child: { entry: "write", nodes: [{ id: "write", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').appendFileSync('child-count','once\\n')"] }, { id: "done", kind: "end", value: { op: "literal", value: "child completed" } }], edges: [{ from: "write", to: "done" }] },
    } };
    const plan = await prepareExecutionPlan(workflow, { cwd: repo, availableModels: [] }); controller.store.create({ id, plan, cwd: repo, input: null }); const { token } = controller.store.reserveLaunch(id);
    const context = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 }, a = controller.store.beginActivation(id, token, context, { kind: "worktree", sideEffect: true });
    const childScope = ["graph", "main", "node", "work", "visit", "0", "worktree", "graph", "child"], manager = new GitWorkspaces(id, controller.directory(id)), allocation = await manager.allocate(repo, a.key, undefined);
    controller.store.setActivationMetadata(id, token, a.key, { workspacePhase: "allocating", workspace: { ...allocation }, operation: { kind: "worktree", source: repo, childScope } });
    await rm(allocation.path, { recursive: true }); controller.store.failActivation(id, token, a.key, "Allocation interrupted"); controller.store.finish(id, token, { status: "failed", error: "Allocation interrupted" });
    const inspected = await controller.recovery(id, a.key); assert.deepEqual(inspected.blockers, []);
    await controller.reconcile({ id, key: a.key, attempt: inspected.attempt, checkpoint: inspected.checkpoint, workspaceDigest: inspected.workspace!.digest, decisionId: "restore-allocation", action: "retry", actor: "fixture", reason: "No child was admitted; inspected missing owned allocation", evidence: [{ path: allocation.path }] });
    await controller.control(id, "resume"); const deadline = Date.now() + 20_000;
    for (;;) { const run = controller.observe(id).run; if (run.status === "succeeded") break; if (run.status === "failed" || Date.now() > deadline) assert.fail(run.error ?? run.status); await sleep(25); }
    assert.equal(await readFile(join(allocation.path, "child-count"), "utf8"), "once\n");
    const parent = controller.store.getActivation(id, a.key)!; assert.equal(parent.attempt, 2); assert.equal((parent.metadata.workspaceRecovery as Record<string, Json>).phase, "allocation-restored");
    assert.equal(controller.store.listActivations(id).find(item => item.kind === "check")!.attempt, 1);
    assert.equal(controller.store.reconciliation(id, "restore-allocation")!.application!.attempt, 2);
    assert.ok(controller.store.events(id).some(event => JSON.stringify(event.payload).includes("registration-archived")));
    assert.equal(createHash("sha256").update(a.key).digest("hex"), allocation.branch.split("/").at(-1));
  } finally { await controller.control(id, "cancel"); controller.close(); }
}));

test("missing child workspace cannot be recreated underneath already checkpointed child work", async () => fixture(async (root, repo) => {
  const controller = new RunController(join(root, "state.sqlite"));
  try {
    for (const phase of ["allocating", "children"]) {
      const id = `run-lost-${phase}`, childScope = ["graph", "main", "node", "work", "visit", "0", "worktree", "graph", "child"];
      const workflow: WorkflowDefinition = { schemaVersion: 1, id: "lost", name: "Lost child files", revision: 1, entryGraph: "main", graphs: {
        main: { entry: "work", nodes: [{ id: "work", kind: "worktree", graphId: "child", input: { op: "literal", value: null } }, { id: "done", kind: "end", value: { op: "literal", value: null } }], edges: [{ from: "work", to: "done" }] },
        child: { entry: "done", nodes: [{ id: "done", kind: "end", value: { op: "literal", value: "checkpointed child" } }], edges: [] },
      } };
      const plan = await prepareExecutionPlan(workflow, { cwd: repo, availableModels: [] }); controller.store.create({ id, plan, cwd: repo, input: null }); const { token } = controller.store.reserveLaunch(id);
      const parent = controller.store.beginActivation(id, token, { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 }, { kind: "worktree", sideEffect: true });
      const manager = new GitWorkspaces(id, controller.directory(id)), allocation = await manager.allocate(repo, parent.key, undefined);
      controller.store.setActivationMetadata(id, token, parent.key, { workspacePhase: phase, workspace: { ...allocation }, operation: { kind: "worktree", source: repo, childScope } });
      const child = controller.store.beginActivation(id, token, { graphId: "child", nodeId: "done", scope: childScope, visit: 0 }, { kind: "end", sideEffect: false }); controller.store.completeActivation(id, token, child.key, "checkpointed child");
      await rm(allocation.path, { recursive: true }); controller.store.failActivation(id, token, parent.key, "Lost workspace"); controller.store.finish(id, token, { status: "failed", error: "Lost workspace" });
      const inspected = await controller.recovery(id, parent.key);
      await assert.rejects(controller.reconcile({ id, key: parent.key, attempt: parent.attempt, checkpoint: inspected.checkpoint, workspaceDigest: inspected.workspace!.digest, action: "retry", decisionId: "cannot-replay-lost-files", actor: "fixture", reason: "Must not discard completed child writes", evidence: [{ missing: allocation.path }] }), /ENOENT/);
      assert.equal(controller.store.reconciliations(id).length, 0); await assert.rejects(access(allocation.path), /ENOENT/);
      assert.equal(controller.store.getActivation(id, child.key)!.attempt, 1); assert.ok(git(repo, "worktree", "list", "--porcelain").includes(allocation.path));
    }
  } finally { controller.close(); }
}));
