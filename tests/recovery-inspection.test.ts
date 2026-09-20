import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, mkdir, rm, symlink, chmod, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { observeRecoveryFiles, recoveryGitDirectories } from "../src/recovery-files.js";
import { recoveryBlockers, recoveryCheckpoint } from "../src/recovery-inspection.js";
import { RunController } from "../src/run-controller.js";
import type { ActivationRecord, RunRecord } from "../src/run-store.js";
import { WorkflowService } from "../src/service.js";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";

async function temp(work: (directory: string) => Promise<void>) { const directory = await realpath(await mkdtemp(join(tmpdir(), "dynamicwf-recovery-"))); try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
test("recovery workspace hashes bytes, names, executable modes and explicit roots without following leaf symlinks", async () => temp(async directory => {
  const root = join(directory, "workspace"), other = join(directory, "outside"); await mkdir(root); await mkdir(other);
  await writeFile(join(root, "result"), "first"); await writeFile(join(other, "external"), "first"); await symlink(other, join(root, "link"));
  const first = await observeRecoveryFiles([root]); assert.deepEqual(first.links, [join(root, "link")]);
  await writeFile(join(other, "external"), "second"); assert.equal((await observeRecoveryFiles([root])).digest, first.digest);
  await writeFile(join(root, "result"), "other"); const changed = await observeRecoveryFiles([root]); assert.notEqual(changed.digest, first.digest);
  await chmod(join(root, "result"), 0o755); assert.notEqual((await observeRecoveryFiles([root])).digest, changed.digest);
  await symlink(root, join(directory, "root-link")); assert.equal((await observeRecoveryFiles([join(directory, "root-link")])).digest, (await observeRecoveryFiles([root])).digest);
  const missing = join(root, "new"); const before = await observeRecoveryFiles([missing]); await writeFile(missing, "created"); assert.notEqual((await observeRecoveryFiles([missing])).digest, before.digest);
}));

test("journal exclusions do not mask a selected managed worktree and overlapping roots are read once", async () => temp(async root => {
  const run = join(root, "run"), worktree = join(run, "worktree"), journal = join(root, "state.sqlite"); await mkdir(worktree, { recursive: true });
  await writeFile(journal, "journal 1"); await writeFile(join(run, "session"), "response 1"); await writeFile(join(worktree, "code"), "code 1");
  const inspect = () => observeRecoveryFiles([root, worktree], [journal, journal + "-wal", run]);
  const before = await inspect(); await writeFile(journal, "journal 2"); await writeFile(journal + "-wal", "new WAL"); await writeFile(join(run, "session"), "response 2");
  assert.equal((await inspect()).digest, before.digest);
  await writeFile(join(worktree, "code"), "code 2"); assert.notEqual((await inspect()).digest, before.digest);
  const whole = await observeRecoveryFiles([root]); assert.equal((await observeRecoveryFiles([root, worktree])).entries, whole.entries);
}));

test("an excluded resource replaced by a symlink cannot hide changes in an unrelated workspace directory", async () => temp(async root => {
  const artifacts = join(root, "artifacts"), resources = join(root, "runtime-resources"); await mkdir(artifacts); await writeFile(join(artifacts, "result"), "first"); await symlink(artifacts, resources);
  const first = await observeRecoveryFiles([root], [resources]); assert.deepEqual(first.excluded, [resources]);
  await writeFile(join(artifacts, "result"), "other"); assert.notEqual((await observeRecoveryFiles([root], [resources])).digest, first.digest);
}));

test("linked Git worktree inspection includes external administrative files and the common repository", async () => temp(async directory => {
  const repo = join(directory, "repo"), worktree = join(directory, "linked"); await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-b", "main"); await writeFile(join(repo, "code"), "code"); git("add", "code"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-m", "base"); git("worktree", "add", "-b", "candidate", worktree);
  const dirs = await recoveryGitDirectories(worktree); assert.ok(dirs.includes(join(repo, ".git"))); assert.equal(dirs.length, 2);
  const first = await observeRecoveryFiles([worktree, ...dirs]); git("config", "recovery.fixture", "changed");
  assert.notEqual((await observeRecoveryFiles([worktree, ...dirs])).digest, first.digest);
}));

test("broken Git administrative pointers fail inspection instead of becoming an absent repository", async () => temp(async directory => {
  await writeFile(join(directory, ".git"), "gitdir: missing\n"); await assert.rejects(recoveryGitDirectories(directory), /ENOENT/);
  const git = join(directory, "admin"); await mkdir(git); await writeFile(join(directory, ".git"), "gitdir: admin\r\n");
  assert.deepEqual(await recoveryGitDirectories(directory), [git]);
  await writeFile(join(git, "commondir"), "../missing\n"); await assert.rejects(recoveryGitDirectories(directory), /ENOENT/);
}));

test("inspection rejects concurrent pause and wait answers invalidate its checkpoint without changing files", async () => temp(async directory => {
  const controller = new RunController(join(directory, "state.sqlite"));
  try {
    const end = { id: "done", kind: "end", value: { op: "literal", value: null } };
    const responseSchema = { type: "object", required: ["confirmed"], additionalProperties: false, properties: { confirmed: { type: "boolean" } } };
    const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "paused", name: "Paused recovery", revision: 1, entryGraph: "main", graphs: {
      main: { entry: "fan", nodes: [{ id: "fan", kind: "parallel", children: ["worker", "waiting"].map(id => ({ id, graphId: id, input: { op: "literal", value: null } })) }, end], edges: [{ from: "fan", to: "done" }] },
      worker: { entry: "work", nodes: [{ id: "work", kind: "check", command: "unused", args: [] }, end], edges: [{ from: "work", to: "done" }] },
      waiting: { entry: "gate", nodes: [{ id: "gate", kind: "await", reason: { op: "literal", value: "Evidence" }, input: { op: "literal", value: null }, responseSchema }, end], edges: [{ from: "gate", to: "done" }] },
    } }, { cwd: directory, availableModels: [] });
    controller.store.create({ id: "run-paused", plan, input: null, cwd: directory }); const { token } = controller.store.reserveLaunch("run-paused");
    controller.store.beginActivation("run-paused", token, { graphId: "main", nodeId: "fan", scope: ["graph", "main"], visit: 0 }, { kind: "parallel", sideEffect: false });
    const scope = (id: string) => ["graph", "main", "node", "fan", "visit", "0", "parallel", id, "graph", id];
    const activation = controller.store.beginActivation("run-paused", token, { graphId: "worker", nodeId: "work", scope: scope("worker"), visit: 0 }, { kind: "check", sideEffect: true });
    const waiting = controller.store.beginActivation("run-paused", token, { graphId: "waiting", nodeId: "gate", scope: scope("waiting"), visit: 0 }, { kind: "await", sideEffect: false });
    const wait = controller.store.openWait("run-paused", token, waiting.key, "Evidence", null, responseSchema);
    controller.store.setActivationMetadata("run-paused", token, activation.key, { operation: { kind: "check", cwd: directory, command: "unused", args: [] } });
    controller.store.markInterrupted("run-paused", token, "Fixture interruption");
    const pending = controller.recovery("run-paused", activation.key); controller.store.requestControl("run-paused", "pause");
    await assert.rejects(pending, /Run changed during recovery inspection/);
    const fresh = await controller.recovery("run-paused", activation.key); assert.deepEqual(fresh.blockers, []); assert.ok(fresh.workspace);
    assert.equal(fresh.desired, "paused"); assert.equal(controller.store.get("run-paused").ownerToken, null);
    const updatedAt = controller.store.get("run-paused").updatedAt;
    controller.store.resolveWait("run-paused", wait.id, { confirmed: true }, "fixture");
    const answered = await controller.recovery("run-paused", activation.key);
    assert.equal(controller.store.get("run-paused").updatedAt, updatedAt); assert.notEqual(answered.checkpoint, fresh.checkpoint);
    assert.equal(answered.workspace?.digest, fresh.workspace.digest); assert.ok(answered.eventSeq > fresh.eventSeq);
  } finally { controller.close(); }
}));

test("completed ancestors and committed collection items seal exact child scopes without sealing siblings", () => {
  const run = { id: "run", status: "failed", desired: "running", ownerToken: null, updatedAt: 1, plan: { hash: "plan" } } as RunRecord;
  const base = { runId: "run", attempt: 1, ownerToken: "old", startedAt: 1, finishedAt: 2, metadata: {} };
  const parent: ActivationRecord = { ...base, sideEffect: false, key: "parent", kind: "parallel", status: "failed", context: { scope: ["graph", "main"], nodeId: "council", graphId: "main", visit: 0 } };
  const child: ActivationRecord = { ...base, sideEffect: true, key: "child", kind: "check", status: "failed", context: { scope: ["graph", "main", "node", "council", "visit", "0", "parallel", "left", "graph", "review"], nodeId: "work", graphId: "review", visit: 0 }, metadata: { operation: { kind: "check", cwd: "/workspace", command: "check", args: [] } } };
  const collected = { seq: 1, runId: "run", key: "parent", itemId: "left", attempt: 1, at: 1, result: { status: "succeeded" as const, value: null } };
  assert.deepEqual(recoveryBlockers(run, child, [parent, child], []).map(b => b.code), []);
  assert.deepEqual(recoveryBlockers(run, child, [{ ...parent, status: "succeeded" }, child], []).map(b => b.code), ["completed-parent"]);
  assert.deepEqual(recoveryBlockers(run, child, [parent, child], [collected]).map(b => b.code), ["collected-item"]);
  assert.deepEqual(recoveryBlockers(run, child, [parent, child], [{ ...collected, itemId: "right" }]), []);
  assert.notEqual(recoveryCheckpoint(run, [parent, child], []), recoveryCheckpoint(run, [parent, child], [collected]));
});

test("public recovery inspection binds a failed operation to separate journal and file digests without inference", { timeout: 20_000 }, async () => temp(async directory => {
  const filename = join(directory, "state.sqlite"), controller = new RunController(filename), service = new WorkflowService(filename);
  try {
    const run = await controller.start({ schemaVersion: 1, id: "recovery", name: "Recovery fixture", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [{ id: "work", kind: "check", command: join(directory, "not-installed"), args: [] }, { id: "done", kind: "end", value: { op: "literal", value: null } }], edges: [{ from: "work", to: "done" }] } } }, null, directory, { availableModels: [] });
    const deadline = Date.now() + 10_000; while (controller.observe(run.id).run.status !== "failed") { if (Date.now() > deadline) throw Error("Failed fixture did not finish"); await sleep(25); }
    const activation = controller.store.listActivations(run.id).find(a => a.kind === "check")!;
    const first = await service.dispatch("run.recovery", { id: run.id, key: activation.key }) as Awaited<ReturnType<RunController["recovery"]>>;
    assert.deepEqual(first.blockers, []); assert.ok(first.workspace); assert.ok(first.outputSchema);
    assert.equal(first.attempt, 1); assert.equal(first.activation.metadata.workerToken, undefined);
    const repeated = await controller.recovery(run.id, activation.key); assert.equal(repeated.checkpoint, first.checkpoint); assert.equal(repeated.workspace?.digest, first.workspace.digest);
    await writeFile(join(directory, "artifact"), "new file"); const changed = await controller.recovery(run.id, activation.key);
    assert.equal(changed.checkpoint, first.checkpoint); assert.notEqual(changed.workspace?.digest, first.workspace.digest);
    assert.equal(controller.store.get(run.id).status, "failed"); assert.equal(controller.store.listActivations(run.id)[0]!.attempt, 1);
    assert.ok(mcpToolDefinitions.find(tool => tool.name === "run_recovery"));
    const output = execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("src/cli.ts"), "run.recovery", "--store", filename], { input: JSON.stringify({ id: run.id, key: activation.key }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    assert.equal(JSON.parse(output).result.workspace.digest, changed.workspace?.digest);
  } finally { service.close(); controller.close(); }
}));

test("recovery refuses undecodable byte names instead of hashing a missing replacement path", async t => {
  const directory = await mkdtemp(join(tmpdir(), "dwf-byte-name-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalid = Buffer.concat([Buffer.from(directory + "/"), Buffer.from([0xff])]);
  try { await writeFile(invalid, "original"); }
  catch (error) {
    if (["EILSEQ", "EINVAL"].includes((error as NodeJS.ErrnoException).code ?? "")) { t.skip("Filesystem refuses non-UTF-8 names"); return; }
    throw error;
  }
  await assert.rejects(observeRecoveryFiles([directory]), /requires UTF-8/);
  await writeFile(invalid, "changed");
  await assert.rejects(observeRecoveryFiles([directory]), /requires UTF-8/);
});

test("recovery preserves Unicode and BOM-leading names as actual filesystem bytes", async t => {
  const directory = await mkdtemp(join(tmpdir(), "dwf-unicode-name-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "\uFEFFПривет-�.txt");
  await writeFile(path, "original"); const before = await observeRecoveryFiles([directory]);
  assert.equal(before.bytes, 8);
  await writeFile(path, "changed"); const after = await observeRecoveryFiles([directory]);
  assert.notEqual(before.digest, after.digest); assert.equal(after.bytes, 7);
});
