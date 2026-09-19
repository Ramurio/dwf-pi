import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { RunController } from "../src/run-controller.js";
import { parseOperation } from "../src/operation-record.js";
import type { WorkflowDefinition } from "../src/graph.js";

const context = { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 };
async function fixture(work: (controller: RunController, directory: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-b01-"))), controller = new RunController(join(directory, "state.sqlite"));
  try { await work(controller, directory); }
  finally {
    for (const run of controller.store.listRuns()) {
      try { await controller.control(run.id, "cancel"); } catch { /* terminal or replaced */ }
      const deadline = Date.now() + 15_000;
      for (;;) {
        const observed = controller.observe(run.id);
        if (!observed.supervisorAlive && !observed.workersAlive && !observed.unresolvedGroups.length) break;
        if (Date.now() > deadline) throw new Error("Fixture processes did not drain");
        await sleep(25);
      }
    }
    controller.close(); await rm(directory, { recursive: true, force: true });
  }
}
async function stopped(controller: RunController, id: string, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const run = controller.observe(id).run;
    if (["failed", "succeeded", "cancelled"].includes(run.status)) return run;
    if (Date.now() > deadline) throw new Error(`Run did not finish: ${run.status} ${run.error ?? ""}`);
    await sleep(25);
  }
}
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("check admission crash before launch can retry the same run once", { timeout: 20_000 }, async () => fixture(async (controller, directory) => {
  const workspace = join(directory, "workspace"); await mkdir(workspace);
  const args = ["-e", "require('node:fs').appendFileSync('marker','once\\n')"];
  const workflow: WorkflowDefinition = { schemaVersion: 1, id: "b01-check", name: "B01 check admission", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [
    { id: "work", kind: "check", command: process.execPath, args }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } },
  ], edges: [{ from: "work", to: "done" }] } } };
  const plan = await prepareExecutionPlan(workflow, { cwd: workspace, availableModels: [] });
  const id = "run-b01-check"; controller.store.create({ id, plan, cwd: workspace, input: null });
  const { token } = controller.store.reserveLaunch(id);
  const a = controller.store.beginActivation(id, token, context, { kind: "check", sideEffect: true });
  const operation = parseOperation(a.metadata.operation);
  assert.equal(operation?.kind, "check"); if (operation?.kind === "check") {
    assert.equal(operation.command, process.execPath); assert.deepEqual(operation.args, args); assert.equal(operation.cwd, workspace);
  }
  assert.equal(a.metadata.workerLaunch, undefined); assert.equal(a.metadata.workerPid, undefined);
  controller.store.markInterrupted(id, token, "Supervisor died after admission");
  const inspected = await controller.recovery(id, a.key);
  assert.deepEqual(inspected.blockers, []); assert.ok(inspected.workspace);
  const continued = await controller.continuationInspect(id);
  assert.ok(!continued.blockers.some(item => item.code === "missing-operation"));
  const replay = controller.store.reserveLaunch(id);
  assert.throws(() => controller.store.beginActivation(id, replay.token, context, { kind: "check", sideEffect: true }), /explicit retry authorization/);
  controller.store.markInterrupted(id, replay.token, "Replay refused without reconciliation");
  const fresh = await controller.recovery(id, a.key); assert.deepEqual(fresh.blockers, []);
  await controller.reconcile({
    id, key: a.key, attempt: fresh.attempt, checkpoint: fresh.checkpoint, workspaceDigest: fresh.workspace!.digest,
    decisionId: "b01-retry-check", action: "retry", actor: "fixture", reason: "No worker was reserved; retry the admitted check",
    evidence: [{ workerLaunch: null }],
  });
  await controller.control(id, "resume");
  const completed = await stopped(controller, id);
  assert.equal(completed.status, "succeeded", completed.error);
  assert.equal(await readFile(join(workspace, "marker"), "utf8"), "once\n");
  assert.equal(controller.store.getActivation(id, a.key)!.attempt, 2);
}));

test("worktree admission crash before allocation retries allocate instead of deadlocking", { timeout: 45_000 }, async () => fixture(async (controller, directory) => {
  const repo = join(directory, "repo"); await mkdir(repo);
  git(repo, "init", "-b", "main"); await writeFile(join(repo, "base"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const workflow: WorkflowDefinition = { schemaVersion: 1, id: "b01-worktree", name: "B01 worktree admission", revision: 1, entryGraph: "main", graphs: {
    main: { entry: "work", nodes: [{ id: "work", kind: "worktree", graphId: "child", input: { op: "literal", value: null } }, { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "work"] } }], edges: [{ from: "work", to: "done" }] },
    child: { entry: "write", nodes: [{ id: "write", kind: "check", command: process.execPath, args: ["-e", "require('node:fs').appendFileSync('child-count','once\\n')"] }, { id: "done", kind: "end", value: { op: "literal", value: "child completed" } }], edges: [{ from: "write", to: "done" }] },
  } };
  const plan = await prepareExecutionPlan(workflow, { cwd: repo, availableModels: [] });
  const id = "run-b01-worktree"; controller.store.create({ id, plan, cwd: repo, input: null });
  const { token } = controller.store.reserveLaunch(id);
  const a = controller.store.beginActivation(id, token, context, { kind: "worktree", sideEffect: true });
  const operation = parseOperation(a.metadata.operation);
  assert.equal(operation?.kind, "worktree"); if (operation?.kind === "worktree") {
    assert.equal(operation.source, repo);
    assert.deepEqual(operation.childScope, ["graph", "main", "node", "work", "visit", "0", "worktree", "graph", "child"]);
  }
  assert.equal(a.metadata.workspacePhase, "allocating"); assert.equal(a.metadata.workspace, undefined);
  controller.store.markInterrupted(id, token, "Supervisor died after worktree admission");
  const inspected = await controller.recovery(id, a.key);
  assert.deepEqual(inspected.blockers, []); assert.ok(inspected.workspace);
  const continued = await controller.continuationInspect(id);
  assert.ok(!continued.blockers.some(item => item.code === "missing-operation" || item.code === "missing-child-workspace"));
  const head = "a".repeat(40);
  await assert.rejects(controller.reconcile({
    id, key: a.key, attempt: inspected.attempt, checkpoint: inspected.checkpoint, workspaceDigest: inspected.workspace!.digest,
    decisionId: "b01-accept-worktree", action: "accept", actor: "fixture", reason: "Must not accept without an allocation",
    evidence: [{ workspace: null }], output: { result: null, workspace: { path: repo, branch: "candidate", base: head, head } },
  }), /No owned workspace allocation was recorded/);
  await controller.reconcile({
    id, key: a.key, attempt: inspected.attempt, checkpoint: inspected.checkpoint, workspaceDigest: inspected.workspace!.digest,
    decisionId: "b01-retry-worktree", action: "retry", actor: "fixture", reason: "Intent-only allocating; retry normal allocation",
    evidence: [{ workspace: null }],
  });
  await controller.control(id, "resume");
  const completed = await stopped(controller, id, 40_000);
  assert.equal(completed.status, "succeeded", completed.error);
  const parent = controller.store.getActivation(id, a.key)!;
  assert.equal(parent.attempt, 2);
  const workspace = parent.output && typeof parent.output === "object" && !Array.isArray(parent.output) ? parent.output.workspace : undefined;
  assert.ok(workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof workspace.path === "string");
  assert.equal(await readFile(join(workspace.path, "child-count"), "utf8"), "once\n");
  assert.equal(controller.store.listActivations(id).find(item => item.kind === "check")!.attempt, 1);
}));

test("agent admission does not invent a task or input before evaluation", async () => fixture(async (controller, directory) => {
  const workflow: WorkflowDefinition = { schemaVersion: 1, id: "b01-agent", name: "B01 agent admission", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [
    { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Do not invent this task" }, config: { outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } },
    { id: "done", kind: "end", value: { op: "literal", value: null } },
  ], edges: [{ from: "work", to: "done" }] } } };
  const plan = await prepareExecutionPlan(workflow, { cwd: directory, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
  const id = "run-b01-agent"; controller.store.create({ id, plan, cwd: directory, input: null });
  const { token } = controller.store.reserveLaunch(id);
  const a = controller.store.beginActivation(id, token, context, { kind: "agent", sideEffect: true });
  assert.equal(parseOperation(a.metadata.operation), undefined);
  controller.store.markInterrupted(id, token, "Supervisor died after agent admission");
  const inspected = await controller.recovery(id, a.key);
  assert.deepEqual(inspected.blockers.map(item => item.code), ["missing-operation"]);
  assert.equal(inspected.workspace, null);
}));
