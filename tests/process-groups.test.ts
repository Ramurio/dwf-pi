import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RunController } from "../src/run-controller.js";
import { groupMembers, parseProcessGroups } from "../src/process-groups.js";
import { WorkflowService } from "../src/service.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { renderRun } from "../src/terminal.js";
import type { Node } from "../src/graph.js";
import { spawn } from "node:child_process";
import { prepareExecutionPlan } from "../src/execution-plan.js";

async function until<T>(work: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) { const value = await work(); if (accept(value)) return value; if (Date.now() > end) throw Error("Process group fixture did not settle"); await sleep(30); }
}
function kill(pid: number) { try { process.kill(pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
async function pidFile(path: string): Promise<number | undefined> { try { return Number(await readFile(path, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; } }

test("OS group observations exclude zombies and preserve only process identifiers and state", () => {
  const rows = parseProcessGroups(" 100 1 100 Ss\n101 1 100 Z\n102 100 100 S+\n103 1 200 R\n104 1 100 ?Es\n");
  assert.deepEqual(groupMembers(100, rows).map(p => p.pid), [100, 102, 104]);
  assert.throws(() => parseProcessGroups("100 1 ? S"), /Invalid OS/);
  assert.throws(() => parseProcessGroups("100 1 100 S extra"), /Invalid OS/);
});

test("a reused group number is unresolved evidence and never authorizes signalling an unrelated process", { skip: process.platform === "win32", timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-reused-group-")), controller = new RunController(join(directory, "state.sqlite"));
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
  let exited = false; unrelated.once("exit", () => { exited = true; });
  try {
    await new Promise<void>((resolve, reject) => { unrelated.once("spawn", resolve); unrelated.once("error", reject); });
    const plan = await prepareExecutionPlan({ schemaVersion: 1, id: "reused", name: "Reused group fixture", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [{ id: "work", kind: "check", command: "unused", args: [] }, { id: "done", kind: "end", value: { op: "literal", value: null } }], edges: [{ from: "work", to: "done" }] } } }, { cwd: directory, availableModels: [] });
    controller.store.create({ id: "run-reused", plan, input: null, cwd: directory }); const { token } = controller.store.reserveLaunch("run-reused");
    controller.store.attachPid("run-reused", token, process.pid);
    const activation = controller.store.beginActivation("run-reused", token, { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 }, { kind: "check", sideEffect: true });
    // Seed the old checkpoint with a number now occupied by a different process.
    controller.store.setActivationMetadata("run-reused", token, activation.key, { workerPid: unrelated.pid!, workerGroupPid: unrelated.pid!, workerGroupState: "pending", workerLaunch: "started", workerToken: "former-worker-token", workerKind: "check" });
    const state = controller.snapshot("run-reused"); assert.equal(state.workersAlive, 0); assert.equal(state.unresolvedGroups[0]!.ownership, "unverified");
    assert.equal(state.presentation.statusLabel, "Проверка процессов");
    await controller.control("run-reused", "cancel"); process.kill(unrelated.pid!, 0); assert.equal(exited, false);
    kill(unrelated.pid!); await until(() => exited, Boolean);
    assert.equal(controller.observe("run-reused").run.status, "cancelled");
  } finally { if (unrelated.pid && !exited) { kill(unrelated.pid); await until(() => exited, Boolean); } controller.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const crash of [false, true]) test(`remaining group members block completion and recovery after ${crash ? "SIGKILL of wrapper and supervisor" : "a successful wrapper response"}`, { skip: process.platform === "win32", timeout: 25_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-groups-")), filename = join(directory, "state.sqlite"), controller = new RunController(filename);
  let descendant: number | undefined, command: number | undefined, supervisor: number | null = null, wrapper: number | undefined;
  try {
    const childCode = `require('node:fs').writeFileSync('descendant.pid',String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    const commandCode = `const fs=require('node:fs');fs.writeFileSync('command.pid',String(process.pid));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}).unref();${crash ? "setInterval(()=>{},1000);" : ""}`;
    const node: Node = { id: "work", kind: "check", command: process.execPath, args: ["-e", commandCode] };
    const run = await controller.start({ schemaVersion: 1, id: "groups", name: "Group recovery", revision: 1, entryGraph: "main", graphs: { main: { entry: "work", nodes: [node, { id: "done", kind: "end", value: { op: "literal", value: null } }], edges: [{ from: "work", to: "done" }] } } }, null, directory, { availableModels: [] });
    supervisor = run.supervisorPid;
    descendant = await until(() => pidFile(join(directory, "descendant.pid")), p => !!p);
    command = await pidFile(join(directory, "command.pid"));
    const activation = controller.store.listActivations(run.id).find(a => a.kind === "check")!;
    wrapper = activation.metadata.workerGroupPid as number; assert.ok(wrapper);
    if (crash) { kill(wrapper); kill(supervisor!); }
    const observed = await until(() => controller.snapshot(run.id), state => !state.supervisorAlive && state.workersAlive === 0 && state.unresolvedGroups.length === 1);
    assert.equal(observed.run.ownerToken, run.ownerToken); assert.notEqual(observed.run.status, "succeeded");
    assert.equal(observed.presentation.liveness.state, "unresolved-groups");
    assert.ok(observed.unresolvedGroups[0]!.processes.some(p => p.pid === descendant));
    assert.equal(controller.store.getActivation(run.id, activation.key)!.metadata.workerGroupState, "pending");
    if (!crash) assert.equal((controller.store.getActivation(run.id, activation.key)!.metadata.failure as any).phase, "cleanup");
    assert.match(renderRun(observed.run, observed.activations, observed.presentation), /Группы процессов требуют проверки/);
    assert.throws(() => controller.store.markInterrupted(run.id, run.ownerToken!, "must not discard pending group"), /not been verified empty/);
    assert.throws(() => controller.store.beginActivation(run.id, run.ownerToken!, activation.context, { kind: "check", sideEffect: true }), /not been verified empty/);
    if (crash) assert.throws(() => controller.store.setActivationMetadata(run.id, run.ownerToken!, activation.key, { workerLaunch: "reserved", workerToken: "replacement" }), /not been verified empty/);
    assert.equal(controller.store.observeWorkerGroupEmpty(run.id, activation.key, "wrong-worker", wrapper), false);
    await controller.control(run.id, "resume"); assert.equal(controller.store.get(run.id).ownerToken, run.ownerToken);

    const service = new WorkflowService(filename), viewer = await startGraphServer(filename, run.id);
    try {
      const status = await service.dispatch("run.status", { id: run.id }) as any;
      const response = await fetch(`${viewer.url}snapshot?id=${encodeURIComponent(run.id)}`); assert.equal(response.status, 200);
      const browser = await response.json() as any;
      assert.deepEqual(status.unresolvedGroups, browser.unresolvedGroups);
      assert.equal(browser.presentation.liveness.state, "unresolved-groups");
      assert.doesNotMatch(JSON.stringify(status.unresolvedGroups), /workerToken|commandLine|childCode|environment/);
    } finally { service.close(); await viewer.close(); }
    await controller.control(run.id, "cancel");
    process.kill(descendant!, 0); // Unknown group membership alone did not authorize a signal.
    kill(descendant!); if (crash && command) kill(command);
    const stopped = await until(() => controller.observe(run.id), state => state.run.status === "cancelled");
    assert.equal(stopped.unresolvedGroups.length, 0);
    assert.equal(controller.store.getActivation(run.id, activation.key)!.metadata.workerGroupState, "empty");
    assert.equal(controller.store.events(run.id).filter(e => e.type === "worker.group_empty").length, 1);
    controller.observe(run.id); assert.equal(controller.store.events(run.id).filter(e => e.type === "worker.group_empty").length, 1);
  } finally {
    if (descendant) kill(descendant); if (command) kill(command); if (wrapper) kill(wrapper); if (supervisor) kill(supervisor);
    controller.close(); await rm(directory, { recursive: true, force: true });
  }
});
