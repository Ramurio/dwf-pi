import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import type { ActivationRecord } from "../src/run-store.js";
import type { Expr, Graph, Node, WorkflowDefinition } from "../src/graph.js";

const literal = (value: any): Expr => ({ op: "literal", value });
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const sequence = (nodes: Node[]): Graph => ({
  entry: nodes[0]!.id,
  nodes,
  edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })),
});
const end = (value: Expr): Node => ({ id: "done", kind: "end", value });
const writeCheck = (script: string): Node => ({ id: "write", kind: "check", command: process.execPath, args: ["-e", script] });

function flow(): WorkflowDefinition {
  return {
    schemaVersion: 1, id: "crash_collect", name: "Collect fan-out crash", revision: 1, entryGraph: "main",
    graphs: {
      main: sequence([
        { id: "fan", kind: "parallel", failurePolicy: "collect", children: [
          { id: "settled", graphId: "settledBranch", input: literal(null) },
          { id: "held", graphId: "heldBranch", input: literal(null) },
        ] },
        end(ref("nodes", "fan")),
      ]),
      settledBranch: sequence([
        { id: "allocate", kind: "worktree", graphId: "settledWrite", input: literal(null) },
        end(ref("nodes", "allocate")),
      ]),
      settledWrite: sequence([
        writeCheck("require('node:fs').appendFileSync('settled.count','once\\n')"),
        end(ref("nodes", "write")),
      ]),
      heldBranch: sequence([
        { id: "allocate", kind: "worktree", graphId: "heldWrite", input: literal(null) },
        end(ref("nodes", "allocate")),
      ]),
      heldWrite: sequence([
        writeCheck("const fs=require('node:fs');fs.appendFileSync('held.count','once\\n');fs.writeFileSync('held.ready','1');"),
        { id: "wait", kind: "await", reason: literal("Hold the second collect child"), input: literal(null), responseSchema: { type: "object" } },
        end(ref("nodes", "write")),
      ]),
    },
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function until<T>(read: () => T, ready: (value: T) => boolean, description: string, timeout = 30_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await sleep(30);
  }
}
function waitStatus(controller: RunController, id: string, status: string) {
  return until(() => controller.observe(id).run, run => run.status === status, `run status ${status}`);
}
function workspacePath(activation: ActivationRecord): string {
  const workspace = activation.metadata.workspace;
  assert.ok(workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof workspace.path === "string");
  return workspace.path;
}
function worktree(controller: RunController, id: string, graphId: string): ActivationRecord {
  const activation = controller.store.listActivations(id).find(item => item.kind === "worktree" && item.context.graphId === graphId);
  assert.ok(activation);
  return activation;
}
function committingEvents(controller: RunController, id: string, key: string): number {
  return controller.store.events(id).filter(event => {
    if (event.type !== "activation.metadata") return false;
    const payload = event.payload as { key?: unknown; metadata?: { workspacePhase?: unknown } };
    return payload.key === key && payload.metadata?.workspacePhase === "committing";
  }).length;
}
function settledPage(controller: RunController, id: string) {
  const parent = controller.store.listActivations(id).find(item => item.kind === "parallel");
  assert.ok(parent);
  const page = controller.store.collections(id, parent.key);
  const record = page.records.find(item => item.itemId === "settled");
  assert.ok(record);
  return { parent, page, record };
}
async function assertSettledOnce(controller: RunController, id: string, base: string, previous?: ReturnType<typeof settledPage>["record"]) {
  const { parent, page, record } = settledPage(controller, id);
  const settled = worktree(controller, id, "settledBranch");
  const writer = controller.store.listActivations(id).find(item => item.kind === "check" && item.context.graphId === "settledWrite");
  assert.ok(writer);
  assert.equal(page.enabled, true);
  assert.equal(record.result.status, "succeeded");
  assert.equal(settled.status, "succeeded");
  assert.equal(settled.attempt, 1);
  assert.equal(writer.attempt, 1);
  assert.equal(settled.metadata.workspacePhase, "complete");
  assert.equal(await readFile(join(workspacePath(settled), "settled.count"), "utf8"), "once\n");
  assert.equal(git(workspacePath(settled), "rev-list", "--count", `${base}..HEAD`), "1");
  assert.equal(git(workspacePath(settled), "rev-parse", "HEAD"), (settled.output as { workspace: { head: string } }).workspace.head);
  assert.equal(git(controller.store.get(id).cwd, "rev-parse", "HEAD"), base);
  assert.equal(committingEvents(controller, id, settled.key), 1);
  assert.equal(controller.store.events(id).filter(event => event.type === "collection.settled" && (event.payload as { itemId?: string }).itemId === "settled").length, 1);
  if (previous) assert.deepEqual(record, previous);
  return { parent, page, record, settled };
}
async function awaitBarrier(controller: RunController, id: string) {
  const state = await until(() => {
    controller.observe(id);
    const parent = controller.store.listActivations(id).find(item => item.kind === "parallel");
    const held = controller.store.listActivations(id).find(item => item.kind === "worktree" && item.context.graphId === "heldBranch");
    const page = parent ? controller.store.collections(id, parent.key) : undefined;
    return { parent, held, page, waits: parent ? controller.store.waits(id) : [] };
  }, value => Boolean(
    value.page?.enabled &&
    value.page.summary.total === 1 &&
    value.page.records.some(item => item.itemId === "settled" && item.result.status === "succeeded") &&
    value.waits.some(item => item.status === "open") &&
    value.held?.status === "running" &&
    value.held.metadata.workspacePhase === "children",
  ), "settled collection and held await barrier");
  assert.equal(await readFile(join(workspacePath(state.held!), "held.ready"), "utf8"), "1");
  assert.equal(await readFile(join(workspacePath(state.held!), "held.count"), "utf8"), "once\n");
  return state;
}
async function fixture(work: (controller: RunController, repo: string, base: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-wave5-crash-collect-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  git(repo, "init", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  const controller = new RunController(join(root, "state.sqlite"));
  try { await work(controller, repo, base); }
  finally {
    for (const run of controller.store.listRuns()) {
      try { await controller.control(run.id, "cancel"); } catch { /* already terminal */ }
      const deadline = Date.now() + 15_000;
      for (;;) {
        const observed = controller.observe(run.id);
        if (!observed.supervisorAlive && observed.workersAlive === 0 && observed.unresolvedGroups.length === 0) break;
        if (Date.now() > deadline) break;
        await sleep(50);
      }
    }
    controller.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("collect fan-out keeps a settled worktree across pause, supervisor crash and resume without duplicating commit admission", { timeout: 60_000 }, async () => fixture(async (controller, repo, base) => {
  const run = await controller.start(flow(), null, repo, { availableModels: [] });
  await awaitBarrier(controller, run.id);
  const first = await assertSettledOnce(controller, run.id, base);
  assert.equal(first.parent.attempt, 1);
  assert.equal(first.record.attempt, 1);
  assert.equal(committingEvents(controller, run.id, worktree(controller, run.id, "heldBranch").key), 0);

  await controller.control(run.id, "pause");
  await waitStatus(controller, run.id, "paused");
  await assertSettledOnce(controller, run.id, base, first.record);
  assert.equal(worktree(controller, run.id, "heldBranch").status, "running");
  assert.equal(worktree(controller, run.id, "heldBranch").metadata.workspacePhase, "children");

  await controller.control(run.id, "resume");
  await waitStatus(controller, run.id, "waiting");
  await assertSettledOnce(controller, run.id, base, first.record);
  assert.equal(settledPage(controller, run.id).parent.attempt, 1);

  const pid = controller.store.get(run.id).supervisorPid;
  assert.ok(pid);
  process.kill(pid, "SIGKILL");
  await waitStatus(controller, run.id, "interrupted");
  await controller.control(run.id, "resume");
  await waitStatus(controller, run.id, "waiting");
  const afterCrash = await assertSettledOnce(controller, run.id, base, first.record);
  assert.equal(afterCrash.parent.attempt, 2);
  assert.equal(afterCrash.record.attempt, 1);
  const heldWriter = controller.store.listActivations(run.id).find(item => item.kind === "check" && item.context.graphId === "heldWrite");
  assert.ok(heldWriter);
  assert.equal(heldWriter.attempt, 1);
  assert.equal(heldWriter.status, "succeeded");
  assert.equal(worktree(controller, run.id, "heldBranch").attempt, 2);
  assert.equal(worktree(controller, run.id, "heldBranch").metadata.workspacePhase, "children");
  assert.equal(await readFile(join(workspacePath(worktree(controller, run.id, "heldBranch")), "held.count"), "utf8"), "once\n");

  const wait = controller.store.waits(run.id).find(item => item.status === "open");
  assert.ok(wait);
  await controller.resolve(run.id, wait.id, {});
  const finished = await waitStatus(controller, run.id, "succeeded");
  const final = await assertSettledOnce(controller, run.id, base, first.record);
  assert.equal(final.page.summary.total, 2);
  assert.equal(final.page.summary.succeeded, 2);
  const held = worktree(controller, run.id, "heldBranch");
  assert.equal(held.status, "succeeded");
  assert.equal(held.attempt, 2);
  assert.equal(held.metadata.workspacePhase, "complete");
  assert.equal(await readFile(join(workspacePath(held), "held.count"), "utf8"), "once\n");
  assert.equal(git(workspacePath(held), "rev-list", "--count", `${base}..HEAD`), "1");
  assert.equal(committingEvents(controller, run.id, held.key), 1);
  const output = finished.output as { settled: { status: string }; held: { status: string } };
  assert.equal(output.settled.status, "succeeded");
  assert.equal(output.held.status, "succeeded");
  assert.deepEqual(output.settled, final.record.result);
}));

test("cancel after one collected worktree child does not collect or commit the parked sibling", { timeout: 45_000 }, async () => fixture(async (controller, repo, base) => {
  const run = await controller.start(flow(), null, repo, { availableModels: [] });
  await awaitBarrier(controller, run.id);
  const first = await assertSettledOnce(controller, run.id, base);
  const held = worktree(controller, run.id, "heldBranch");
  const heldPath = workspacePath(held);
  await controller.control(run.id, "cancel");
  const cancelled = await waitStatus(controller, run.id, "cancelled");
  assert.equal(cancelled.output, undefined);
  const page = settledPage(controller, run.id).page;
  assert.equal(page.summary.total, 1);
  assert.equal(page.records.some(item => item.itemId === "held"), false);
  await assertSettledOnce(controller, run.id, base, first.record);
  const parked = worktree(controller, run.id, "heldBranch");
  assert.notEqual(parked.status, "succeeded");
  assert.equal(parked.output, undefined);
  assert.equal(committingEvents(controller, run.id, parked.key), 0);
  assert.equal(git(heldPath, "rev-parse", "HEAD"), base);
  assert.equal(await readFile(join(heldPath, "held.count"), "utf8"), "once\n");
  const resumed = await controller.control(run.id, "resume");
  assert.equal(resumed.status, "cancelled");
  assert.equal(controller.observe(run.id).supervisorAlive, false);
  assert.equal(await readFile(join(workspacePath(worktree(controller, run.id, "settledBranch")), "settled.count"), "utf8"), "once\n");
}));
