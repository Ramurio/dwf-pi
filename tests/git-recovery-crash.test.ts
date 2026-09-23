import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { parseOperation } from "../src/operation-record.js";
import { parseWorkspaceSources, type WorkspaceRecord } from "../src/workspaces.js";
import type { ActivationRecord } from "../src/run-store.js";
import type { Expr, Graph, Node, Json, WorkflowDefinition } from "../src/graph.js";

const literal = (value: Json): Expr => ({ op: "literal", value }), ref = (...path: string[]): Expr => ({ op: "ref", path });
const sequence = (nodes: Node[]): Graph => ({ entry: nodes[0]!.id, nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) });
const end = (value: Expr): Node => ({ id: "done", kind: "end", value });
function definition(integration: boolean | "agent"): WorkflowDefinition {
  if (integration === "agent") return {
    schemaVersion: 1, id: "agent_crash", name: "Actual agent admission crash", revision: 1, entryGraph: "main",
    graphs: { main: sequence([
      { id: "binding", kind: "transform", value: literal({ task: "Task from checkpoint", input: { exact: "nested value", secretFixture: "not public" } }) },
      { id: "work", kind: "agent", role: "general", task: ref("nodes", "binding", "task"), input: ref("nodes", "binding", "input"), config: { tools: [], permission: "read-only" } },
      end(ref("nodes", "work")),
    ]) },
  };
  const labels = integration ? ["left", "right"] : ["candidate"];
  const graphs: Record<string, Graph> = Object.fromEntries(labels.map(label => [label, sequence([
    { id: "write", kind: "check", command: process.execPath, args: ["-e", `const fs=require('node:fs');fs.appendFileSync('${label}.count','once\\n');fs.writeFileSync('${label}.txt','candidate data\\n');`] },
    end(literal({ child: label, completed: true })),
  ])]));
  graphs.main = sequence([
    ...labels.map(label => ({ id: label, kind: "worktree" as const, graphId: label, input: literal(null) })),
    ...(integration ? [{ id: "merge", kind: "integrate" as const, sources: { op: "array" as const, items: labels.map(label => ref("nodes", label)) } }] : []),
    end(ref("nodes", integration ? "merge" : "candidate")),
  ]);
  return { schemaVersion: 1, id: "git_crash", name: "Actual Git crash recovery", revision: 1, entryGraph: "main", graphs };
}
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function until<T>(read: () => T | undefined, description: string, timeout = 25_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) { const result = read(); if (result !== undefined) return result; if (Date.now() > deadline) throw new Error(`Timed out: ${description}`); await sleep(30); }
}
async function crashedFixture(point: string, integration: boolean | "agent", work: (controller: RunController, id: string, repo: string, base: string, selected: ActivationRecord) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-git-crash-"))), repo = join(root, "repo"), filename = join(root, "state.sqlite"); await mkdir(repo);
  git(repo, "init", "-b", "main"); await writeFile(join(repo, "base.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base"); const base = git(repo, "rev-parse", "HEAD");
  const controller = new RunController(filename), id = `run-${point}`; let child: ChildProcess | undefined, closed = false;
  try {
    const plan = await prepareExecutionPlan(definition(integration), { cwd: repo, availableModels: integration === "agent" ? [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] : [] });
    controller.store.create({ id, plan, cwd: repo, input: null }); const { token } = controller.store.reserveLaunch(id);
    child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", resolve("tests/fixtures/git-recovery-crash.ts"), resolve("src/supervisor.ts"), "--store", filename, "--run", id, "--owner", token, "--directory", controller.directory(id)], {
      detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DYNAMICWF_TEST_GIT_CRASH_POINT: point },
    });
    let stderr = "", signal: NodeJS.Signals | null = null, spawnError: Error | undefined;
    child.stderr!.on("data", chunk => { stderr += String(chunk); }); child.stdout!.resume();
    child.once("error", error => { spawnError = error; closed = true; }); child.once("close", (_code, actual) => { signal = actual; closed = true; });
    await until(() => closed ? true : undefined, `SIGKILL at ${point}`);
    if (spawnError) throw spawnError;
    assert.equal(signal, "SIGKILL", stderr); assert.match(stderr, new RegExp(`Fixture SIGKILL at ${point}`));
    const observed = controller.observe(id); assert.equal(observed.supervisorAlive, false); assert.equal(observed.workersAlive, 0); assert.deepEqual(observed.unresolvedGroups, []);
    assert.equal(observed.run.status, "interrupted"); assert.equal(observed.run.ownerToken, null);
    const selected = controller.store.listActivations(id).find(a => a.kind === (integration === "agent" ? "agent" : integration ? "integrate" : "worktree") && a.status === "interrupted")!;
    assert.ok(selected); assert.equal(selected.attempt, 1); assert.ok(parseOperation(selected.metadata.operation));
    const before = git(repo, "rev-parse", "HEAD");
    await controller.control(id, "resume");
    const refused = await until(() => { const run = controller.observe(id).run; return run.status === "failed" ? run : undefined; }, "refusal of implicit Git replay");
    assert.match(refused.error!, /explicit retry authorization/); assert.equal(git(repo, "rev-parse", "HEAD"), before);
    assert.equal(controller.store.getActivation(id, selected.key)!.attempt, 1);
    await work(controller, id, repo, base, selected);
  } finally {
    if (controller.store.listRuns().some(run => run.id === id)) {
      await controller.control(id, "cancel");
      await until(() => { const observed = controller.observe(id); return !observed.supervisorAlive && !observed.workersAlive && !observed.unresolvedGroups.length ? true : undefined; }, "fixture process cleanup", 15_000);
    }
    if (child && !closed) { child.kill("SIGKILL"); await until(() => closed ? true : undefined, "fixture supervisor reap", 5_000); }
    controller.close(); await rm(root, { recursive: true, force: true });
  }
}
async function decision(controller: RunController, id: string, selected: ActivationRecord, action: "accept" | "retry", output?: Json) {
  const inspection = await controller.recovery(id, selected.key); assert.deepEqual(inspection.blockers, []); assert.ok(inspection.workspace);
  return { id, key: selected.key, attempt: inspection.attempt, checkpoint: inspection.checkpoint, workspaceDigest: inspection.workspace.digest,
    decisionId: `${id}-decision`, action, actor: "crash-fixture", reason: "Inspected actual Git state after supervisor SIGKILL", evidence: [{ point: id }], ...(action === "accept" ? { output: output! } : {}) };
}
async function complete(controller: RunController, id: string) {
  await controller.control(id, "resume");
  const final = await until(() => { const run = controller.observe(id).run; return ["succeeded", "failed"].includes(run.status) ? run : undefined; }, "reconciled run completion");
  assert.equal(final.status, "succeeded", final.error); return final;
}
async function rejectChangedCompletedHead(controller: RunController, id: string, selected: ActivationRecord, cwd: string, recorded: string, output: (head: string) => Json) {
  git(cwd, "commit", "--allow-empty", "-m", "External commit after the recorded completion");
  const changed = git(cwd, "rev-parse", "HEAD"), branch = git(cwd, "symbolic-ref", "HEAD");
  for (const action of ["retry", "accept"] as const) {
    const r = await decision(controller, id, selected, action, output(changed));
    await assert.rejects(controller.reconcile(r), /head changed after recorded completion/);
    assert.equal(controller.store.reconciliations(id).length, 0); assert.equal(git(cwd, "rev-parse", "HEAD"), changed);
  }
  // Fixture-only repair: preserve the added empty commit and CAS the known branch back; no file reset.
  git(cwd, "branch", "fixture-retained-external", changed); git(cwd, "update-ref", branch, recorded, changed);
  assert.equal(git(cwd, "rev-parse", "fixture-retained-external"), changed);
}

for (const point of ["allocation-intent", "allocation-created"]) test(`real ${point} SIGKILL restores allocation before admitting one child`, { timeout: 45_000 }, async () => crashedFixture(point, false, async (controller, id, _repo, base, selected) => {
  assert.equal(selected.metadata.workspacePhase, "allocating"); assert.equal(controller.store.listActivations(id).filter(a => a.kind === "check").length, 0);
  const operation = parseOperation(selected.metadata.operation)!; assert.equal(operation.kind === "worktree" && operation.childResult, undefined);
  const allocation = selected.metadata.workspace as unknown as WorkspaceRecord;
  if (point === "allocation-created") assert.equal(git(allocation.path, "rev-parse", "HEAD"), base);
  await controller.reconcile(await decision(controller, id, selected, "retry")); await complete(controller, id);
  assert.equal(await readFile(join(allocation.path, "candidate.count"), "utf8"), "once\n");
  assert.equal(git(allocation.path, "rev-list", "--count", `${base}..HEAD`), "1");
  assert.equal(controller.store.listActivations(id).find(a => a.kind === "check")!.attempt, 1);
  assert.equal(controller.store.getActivation(id, selected.key)!.attempt, 2);
}));

for (const point of ["worktree-staged", "worktree-committed", "worktree-checkpoint"]) test(`real ${point} SIGKILL preserves child work and reconciles without duplicate writes`, { timeout: 45_000 }, async () => crashedFixture(point, false, async (controller, id, repo, base, selected) => {
  const operation = parseOperation(selected.metadata.operation)!; assert.equal(operation.kind, "worktree"); if (operation.kind !== "worktree") return;
  assert.deepEqual(operation.childResult, { child: "candidate", completed: true });
  const allocation = selected.metadata.workspace as unknown as WorkspaceRecord, head = git(allocation.path, "rev-parse", "HEAD");
  assert.equal(selected.metadata.workspacePhase, point === "worktree-checkpoint" ? "complete" : "committing");
  assert.equal(await readFile(join(allocation.path, "candidate.count"), "utf8"), "once\n"); assert.equal(git(repo, "rev-parse", "HEAD"), base);
  if (point === "worktree-staged") {
    assert.equal(head, base); assert.notEqual(git(allocation.path, "diff", "--cached", "--name-only"), "");
    const r = await decision(controller, id, selected, "retry"); await controller.reconcile(r); await complete(controller, id);
    assert.equal(git(allocation.path, "rev-list", "--count", `${base}..HEAD`), "1");
  } else {
    assert.notEqual(head, base); assert.equal(git(allocation.path, "status", "--porcelain"), "");
    const output = { result: operation.childResult!, workspace: { path: allocation.path, branch: allocation.branch, base: allocation.base, head } };
    if (point === "worktree-checkpoint") {
      const changedFile = join(allocation.path, "after-completion.txt"); await writeFile(changedFile, "External uncommitted content\n");
      await assert.rejects(controller.reconcile(await decision(controller, id, selected, "retry")), /must be clean/);
      assert.equal(await readFile(changedFile, "utf8"), "External uncommitted content\n"); await rm(changedFile);
      await rejectChangedCompletedHead(controller, id, selected, allocation.path, head, changed => ({ ...output, workspace: { ...output.workspace, head: changed } }));
    }
    const r = await decision(controller, id, selected, "accept", output); const receipt = await controller.reconcile(r);
    assert.deepEqual((await complete(controller, id)).output, output); assert.equal(git(allocation.path, "rev-parse", "HEAD"), head);
    assert.deepEqual(await controller.reconcile(r), receipt);
  }
  assert.equal(await readFile(join(allocation.path, "candidate.count"), "utf8"), "once\n");
  assert.equal(controller.store.listActivations(id).find(a => a.kind === "check")!.attempt, 1);
  const attempts = controller.store.attempts(id, selected.key); assert.equal(attempts.records.length, 1); assert.equal(attempts.current.attempt, 2); assert.deepEqual(attempts.records[0]!.metadata.operation, selected.metadata.operation);
}));

test("real agent admission SIGKILL preserves dynamic inputs without launching a worker", { timeout: 30_000 }, async () => crashedFixture("agent-admission", "agent", async (controller, id, repo, base, selected) => {
  const operation = parseOperation(selected.metadata.operation)!;
  assert.equal(operation.kind, "agent"); if (operation.kind !== "agent") return;
  assert.equal(operation.task, "Task from checkpoint");
  assert.deepEqual(operation.input, { exact: "nested value", secretFixture: "not public" });
  assert.equal(operation.cwd, repo); assert.equal(operation.continuedSessionFile, undefined);
  assert.ok(operation.sessionDirectory.startsWith(join(controller.directory(id), "sessions")));
  assert.ok(operation.resourceDirectory.startsWith(join(controller.directory(id), "resources")));
  assert.equal(selected.metadata.workerToken, undefined); assert.equal(selected.metadata.workerPid, undefined);
  assert.equal(git(repo, "rev-parse", "HEAD"), base);
  const output = { result: "Explicit operator replacement after inspecting an unstarted operation" };
  await controller.reconcile(await decision(controller, id, selected, "accept", output));
  assert.deepEqual((await complete(controller, id)).output, output);
  // Явное accept материализуется отдельной попыткой без вызова модели.
  assert.equal(controller.store.getActivation(id, selected.key)!.attempt, 2);
}));

test("real integrate admission SIGKILL preserves exact inputs and requires explicit retry", { timeout: 60_000 }, async () => crashedFixture("integrate-admission", true, async (controller, id, repo, base, selected) => {
  const operation = parseOperation(selected.metadata.operation)!;
  assert.equal(operation.kind, "integrate"); if (operation.kind !== "integrate") return;
  assert.equal(operation.target, repo); assert.equal(operation.progress, undefined);
  assert.deepEqual(operation.sources, controller.store.listActivations(id).filter(a => a.kind === "worktree").map(a => a.output));
  assert.equal(git(repo, "rev-parse", "HEAD"), base);
  await controller.reconcile(await decision(controller, id, selected, "retry"));
  await complete(controller, id);
  for (const label of ["left", "right"]) assert.equal(await readFile(join(repo, `${label}.count`), "utf8"), "once\n");
  assert.equal(git(repo, "rev-list", "--first-parent", "--count", `${base}..HEAD`), "2");
  assert.equal(controller.store.getActivation(id, selected.key)!.attempt, 2);
}));

for (const point of ["merge-first", "merge-last", "integration-checkpoint"]) test(`real ${point} SIGKILL reconciles the exact committed merge frontier`, { timeout: 60_000 }, async () => crashedFixture(point, true, async (controller, id, repo, base, selected) => {
  const operation = parseOperation(selected.metadata.operation)!; assert.equal(operation.kind, "integrate"); if (operation.kind !== "integrate") return;
  assert.equal(operation.progress!.originalHead, base); assert.equal(operation.progress!.phase, point === "integration-checkpoint" ? "complete" : "merging");
  const sources = parseWorkspaceSources(operation.sources), interruptedHead = git(repo, "rev-parse", "HEAD");
  const count = () => git(repo, "rev-list", "--first-parent", "--count", `${base}..HEAD`);
  assert.equal(count(), point === "merge-first" ? "1" : "2");
  const output = { workspace: { path: repo, branch: "main", base, head: interruptedHead }, merged: sources.map(source => source.head) };
  if (point === "merge-first") {
    await assert.rejects(controller.reconcile(await decision(controller, id, selected, "accept", output)), /merge-base failed/);
    assert.equal(controller.store.reconciliations(id).length, 0);
    const r = await decision(controller, id, selected, "retry"); await controller.reconcile(r); const final = await complete(controller, id);
    assert.equal((final.output as { workspace: { base: string } }).workspace.base, interruptedHead);
    const current = parseOperation(controller.store.getActivation(id, selected.key)!.metadata.operation)!;
    assert.equal(current.kind === "integrate" && current.progress!.originalHead, interruptedHead);
  } else {
    if (point === "integration-checkpoint") await rejectChangedCompletedHead(controller, id, selected, repo, interruptedHead, changed => ({ ...output, workspace: { ...output.workspace, head: changed } }));
    const r = await decision(controller, id, selected, "accept", output); await controller.reconcile(r); assert.deepEqual((await complete(controller, id)).output, output);
    assert.equal(git(repo, "rev-parse", "HEAD"), interruptedHead);
  }
  assert.equal(count(), "2");
  for (const label of ["left", "right"]) assert.equal(await readFile(join(repo, `${label}.count`), "utf8"), "once\n");
  assert.ok(controller.store.listActivations(id).filter(a => a.kind === "check" || a.kind === "worktree").every(a => a.attempt === 1));
  assert.deepEqual(controller.store.attempts(id, selected.key).records[0]!.metadata.operation, selected.metadata.operation);
}));

for (const integration of [false, true]) test(`explicit retry of a recorded ${integration ? "integration" : "worktree"} completion preserves Git commits and child checkpoints`, { timeout: 60_000 }, async () => {
  const point = integration ? "integration-checkpoint" : "worktree-checkpoint";
  await crashedFixture(point, integration, async (controller, id, repo, base, selected) => {
    const cwd = integration ? repo : (selected.metadata.workspace as unknown as WorkspaceRecord).path, head = git(cwd, "rev-parse", "HEAD");
    const children = controller.store.listActivations(id).filter(a => a.key !== selected.key);
    const r = await decision(controller, id, selected, "retry"); await controller.reconcile(r);
    const final = await complete(controller, id);
    assert.equal(git(cwd, "rev-parse", "HEAD"), head);
    assert.equal(git(cwd, "rev-list", "--first-parent", "--count", `${base}..HEAD`), integration ? "2" : "1");
    for (const child of children) assert.deepEqual(controller.store.getActivation(id, child.key), child);
    assert.equal(controller.store.getActivation(id, selected.key)!.attempt, 2);
    assert.equal(controller.store.reconciliation(id, r.decisionId)!.application!.attempt, 2);
    if (integration) assert.equal((final.output as { workspace: { base: string } }).workspace.base, head);
    else assert.equal(await readFile(join(cwd, "candidate.count"), "utf8"), "once\n");
    const events = controller.store.events(id).length; await controller.reconcile(r); assert.equal(controller.store.events(id).length, events);
  });
});
