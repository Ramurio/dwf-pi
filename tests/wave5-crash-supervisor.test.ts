import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunController } from "../src/run-controller.js";
import type { RunRecord } from "../src/run-store.js";
import type { Node, WorkflowDefinition } from "../src/graph.js";

const posix = process.platform !== "win32";
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(work: () => boolean | Promise<boolean>, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await work()) return; await delay(25); }
  throw new Error(`Run integration condition was not met within ${ms}ms`);
}
function executing(pid: number): boolean {
  try { process.kill(pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
  try { return !execFileSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().startsWith("Z"); }
  catch { return false; }
}
function kill(pid: number, group = false): void {
  try { process.kill(group ? -pid : pid, "SIGKILL"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
function durableCheck(id: string, waitForAck: boolean, releasePath?: string): Node {
  const marker = `${id}.marker`, pidFile = `${id}.pid`, release = releasePath ?? `${id}.release`;
  const script = `const fs=require('node:fs');
    const fd=fs.openSync(${JSON.stringify(marker)},'a');
    fs.writeSync(fd,'once\\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
    ${waitForAck
      ? `const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.stdout.write(${JSON.stringify(`${id} finished`)});}},20);`
      : `process.stdout.write(${JSON.stringify(`${id} finished`)});`}`;
  return { id, kind: "check", command: process.execPath, args: ["-e", script] };
}
function flow(nodes: Node[]): WorkflowDefinition {
  return { schemaVersion: 1, id: "wave5_crash_supervisor", name: "Supervisor crash saved effects", revision: 1, entryGraph: "main", graphs: {
    main: { entry: nodes[0]!.id, nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) },
  } };
}
async function status(controller: RunController, id: string, expected: string): Promise<RunRecord> {
  let record: RunRecord | undefined;
  try {
    await until(() => {
      record = controller.observe(id).run;
      if (["failed", "cancelled"].includes(record.status) && record.status !== expected) throw new Error(`Unexpected ${record.status}: ${record.error ?? ""}`);
      return record.status === expected;
    });
  } catch (error) {
    let log = "";
    try { log = await readFile(join(controller.directory(id), "supervisor.log"), "utf8"); } catch { /* diagnostic only */ }
    throw new Error(`${String(error)}\nLast run state: ${JSON.stringify({ status: record?.status, desired: record?.desired, error: record?.error })}\nSupervisor log:\n${log}`);
  }
  return record!;
}

test("supervisor and worker SIGKILL after a durable check write keep completed checkpoints and require explicit recovery", { skip: !posix, timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-wave5-crash-supervisor-"));
  const workspace = join(directory, "workspace");
  const uncertainRelease = join(directory, "uncertain.release");
  await mkdir(workspace);
  const controller = new RunController(join(directory, "state.sqlite"));
  const owned = new Set<number>();
  try {
    const run = await controller.start(flow([
      durableCheck("saved", false),
      durableCheck("uncertain", true, uncertainRelease),
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "uncertain"] } },
    ]), null, workspace);
    const cwd = run.cwd;
    await until(async () => {
      const saved = controller.store.listActivations(run.id).find(a => a.context.nodeId === "saved");
      const uncertain = controller.store.listActivations(run.id).find(a => a.context.nodeId === "uncertain");
      if (saved?.status !== "succeeded" || typeof uncertain?.metadata.workerPid !== "number") return false;
      try {
        const commandPid = Number(await readFile(join(cwd, "uncertain.pid"), "utf8"));
        return Number.isSafeInteger(commandPid) && commandPid > 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    });
    const saved = controller.store.listActivations(run.id).find(a => a.context.nodeId === "saved")!;
    const uncertain = controller.store.listActivations(run.id).find(a => a.context.nodeId === "uncertain")!;
    const supervisorPid = controller.store.get(run.id).supervisorPid!;
    const workerPid = uncertain.metadata.workerPid as number;
    const commandPid = Number(await readFile(join(cwd, "uncertain.pid"), "utf8"));
    assert.ok(supervisorPid > 0 && workerPid > 0 && Number.isSafeInteger(commandPid) && commandPid > 0);
    owned.add(supervisorPid); owned.add(workerPid); owned.add(commandPid);
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.attempt, 1);
    assert.equal(saved.sideEffect, true);
    assert.deepEqual(saved.output, { exitCode: 0, stdout: "saved finished", stderr: "" });
    assert.equal(await readFile(join(cwd, "saved.marker"), "utf8"), "once\n");
    assert.equal(await readFile(join(cwd, "uncertain.marker"), "utf8"), "once\n");
    assert.equal(uncertain.status, "running");
    // Exact barrier: durable marker exists, result JSON has not been acknowledged.
    // Signal only PIDs created by this fixture.
    kill(supervisorPid);
    kill(workerPid, true);
    kill(commandPid);
    await until(() => !executing(supervisorPid) && !executing(workerPid) && !executing(commandPid));
    await until(() => {
      const observed = controller.observe(run.id);
      return !observed.supervisorAlive && observed.workersAlive === 0 && observed.unresolvedGroups.length === 0
        && observed.run.status === "interrupted" && observed.run.ownerToken === null;
    });
    const interruptedSaved = controller.store.getActivation(run.id, saved.key)!;
    const interruptedUncertain = controller.store.getActivation(run.id, uncertain.key)!;
    assert.equal(interruptedSaved.status, "succeeded");
    assert.equal(interruptedSaved.attempt, 1);
    assert.deepEqual(interruptedSaved.output, saved.output);
    assert.equal(interruptedUncertain.status, "interrupted");
    assert.equal(interruptedUncertain.attempt, 1);
    const failure = interruptedUncertain.metadata.failure;
    assert.equal(failure && typeof failure === "object" && !Array.isArray(failure) ? failure.effects : undefined, "unknown");
    assert.equal(failure && typeof failure === "object" && !Array.isArray(failure) ? failure.code : undefined, "interrupted");
    const savedRecovery = await controller.recovery(run.id, saved.key);
    assert.ok(savedRecovery.blockers.some(blocker => blocker.code === "attempt-not-failed"));
    const resumed = await controller.control(run.id, "resume");
    if (resumed.supervisorPid) owned.add(resumed.supervisorPid);
    const refused = await status(controller, run.id, "failed");
    assert.match(refused.error ?? "", /explicit retry authorization/);
    assert.equal(await readFile(join(cwd, "saved.marker"), "utf8"), "once\n");
    assert.equal(await readFile(join(cwd, "uncertain.marker"), "utf8"), "once\n");
    assert.equal(controller.store.getActivation(run.id, saved.key)!.attempt, 1);
    assert.equal(controller.store.getActivation(run.id, uncertain.key)!.status, "interrupted");
    assert.equal(controller.store.getActivation(run.id, uncertain.key)!.attempt, 1);
    const inspection = await controller.recovery(run.id, uncertain.key);
    assert.deepEqual(inspection.blockers, []);
    assert.ok(inspection.workspace);
    assert.equal(inspection.activation.status, "interrupted");
    await controller.reconcile({
      id: run.id, key: uncertain.key, attempt: inspection.attempt, checkpoint: inspection.checkpoint,
      workspaceDigest: inspection.workspace.digest, decisionId: `${run.id}-retry`, action: "retry",
      actor: "wave5-crash-fixture", reason: "Inspected durable marker after supervisor SIGKILL; authorizing one retry",
      evidence: [{ marker: "uncertain.marker", bytes: "once\n" }],
    });
    // Harness barrier stays outside hashed cwd so retry admission keeps the crash digest.
    await writeFile(uncertainRelease, "release");
    const recovered = await controller.control(run.id, "resume");
    if (recovered.supervisorPid) owned.add(recovered.supervisorPid);
    const finished = await status(controller, run.id, "succeeded");
    assert.equal(finished.status, "succeeded", finished.error);
    assert.equal(await readFile(join(cwd, "saved.marker"), "utf8"), "once\n");
    assert.equal(await readFile(join(cwd, "uncertain.marker"), "utf8"), "once\nonce\n");
    assert.equal(controller.store.getActivation(run.id, saved.key)!.attempt, 1);
    assert.equal(controller.store.getActivation(run.id, uncertain.key)!.attempt, 2);
    assert.equal(controller.store.getActivation(run.id, uncertain.key)!.status, "succeeded");
    const started = controller.store.events(run.id).filter(event => event.type === "activation.started");
    assert.equal(started.filter(event => (event.payload as { key?: string }).key === saved.key).length, 1);
    assert.equal(started.filter(event => (event.payload as { key?: string }).key === uncertain.key).length, 2);
  } finally {
    for (const run of controller.store.listRuns()) {
      await controller.control(run.id, "cancel").catch(() => {});
      if (run.supervisorPid) owned.add(run.supervisorPid);
      for (const activation of controller.store.listActivations(run.id)) {
        if (typeof activation.metadata.workerPid === "number") owned.add(activation.metadata.workerPid);
      }
      await until(() => {
        const observed = controller.observe(run.id);
        return !observed.supervisorAlive && !observed.workersAlive && observed.unresolvedGroups.length === 0;
      }, 15_000).catch(() => {});
    }
    for (const pid of owned) if (executing(pid)) kill(pid);
    await until(() => [...owned].every(pid => !executing(pid)), 5_000).catch(() => {});
    controller.close();
    await rm(directory, { recursive: true, force: true });
  }
});
