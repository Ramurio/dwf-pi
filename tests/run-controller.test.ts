import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RunController } from "../src/run-controller.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { randomUUID } from "node:crypto";
import type { RunRecord } from "../src/run-store.js";
import type { Node, WorkflowDefinition } from "../src/graph.js";

const posix = process.platform !== "win32";
const delay = (ms: number) => new Promise<void>(resolveDelay => setTimeout(resolveDelay, ms));
async function until(work: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await work()) return; await delay(25); }
  throw new Error(`Run integration condition was not met within ${ms}ms`);
}
async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
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
const check = (id: string, script: string): Node => ({ id, kind: "check", command: process.execPath, args: ["-e", script] });
function flow(nodes: Node[]): WorkflowDefinition {
  return { schemaVersion: 1, id: "integration", name: "Integration", revision: 1, entryGraph: "main", graphs: {
    main: { entry: nodes[0]!.id, nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) },
  } };
}
function waitingCheck(id: string): Node {
  return check(id, `const fs=require('node:fs');fs.appendFileSync('${id}.count','1\\n');
    fs.writeFileSync('${id}.pid',String(process.pid));
    const t=setInterval(()=>{if(fs.existsSync('${id}.release')){clearInterval(t);process.stdout.write('${id} finished');}},20);`);
}
function secondCheck(): Node {
  return check("second", "const fs=require('node:fs');fs.appendFileSync('second.count','1\\n');process.stdout.write('second finished');");
}

test("a reserved worker without a PID prevents dead-owner recovery and can be cancelled by identity", { skip: !posix, timeout: 20_000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dynamicwf-reserved-worker-"));
  const controller = new RunController(join(workspace, "state.sqlite"));
  try {
    for (const kind of ["check", "pi"] as const) {
      const node: Node = kind === "check" ? check("work", "process.exit(0)")
        : { id: "work", kind: "agent", role: "general", task: { op: "literal", value: "Offline observation" } };
      const plan = await prepareExecutionPlan(flow([node, { id: "done", kind: "end", value: { op: "literal", value: null } }]),
        { cwd: workspace, availableModels: [{ provider: "offline", id: "fixture", thinkingLevels: ["off"] }] });
      const id = `run-reserved-${kind}`;
      controller.store.create({ id, plan, input: null, cwd: workspace });
      const { token } = controller.store.reserveLaunch(id);
      // A live PID with the wrong script/owner is not a live supervisor. This
      // fixture owns worker cleanup explicitly; it never signals this fake PID.
      controller.store.attachPid(id, token, process.pid);
      const activation = controller.store.beginActivation(id, token, { graphId: "main", nodeId: "work", scope: ["graph", "main"], visit: 0 }, { kind: node.kind, sideEffect: true });
      const identity = randomUUID();
      controller.store.setActivationMetadata(id, token, activation.key, { workerToken: identity, workerKind: kind, workerPid: null, workerLaunch: "reserved" });
      const worker = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), resolve(`src/${kind === "check" ? "check" : "pi"}-worker-process.ts`), "--worker-token", identity],
        { cwd: workspace, detached: true, stdio: ["pipe", "ignore", "ignore", "ipc"] });
      let exited = false; worker.once("exit", () => { exited = true; });
      try {
        await new Promise<void>((resolve, reject) => { worker.once("spawn", resolve); worker.once("error", reject); });
        const observed = controller.snapshot(id);
        assert.equal(observed.supervisorAlive, false); assert.equal(observed.workersAlive, 1);
        assert.equal(observed.presentation.liveness.state, "orphaned-workers");
        assert.equal(observed.run.ownerToken, token); assert.notEqual(observed.run.status, "interrupted");
        assert.equal(controller.store.getActivation(id, activation.key)!.metadata.workerPid, null, "read does not manufacture a PID checkpoint");
        await controller.control(id, "resume"); assert.equal(controller.store.get(id).ownerToken, token);
        await controller.control(id, "cancel"); await until(() => exited);
        const finished = controller.observe(id); assert.equal(finished.workersAlive, 0); assert.equal(finished.run.status, "cancelled");
      } finally { if (worker.pid && !exited) { kill(worker.pid, true); await until(() => exited); } }
    }
  } finally { controller.close(); await rm(workspace, { recursive: true, force: true }); }
});
function sequence(): WorkflowDefinition {
  return flow([waitingCheck("first"), secondCheck(), { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "second"] } }]);
}
interface Fixture { directory: string; workspace: string; filename: string; controller: RunController; track: (run: RunRecord) => void }
async function fixture(work: (fixture: Fixture) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-controller-"));
  const workspace = join(directory, "external-workspace");
  const filename = join(directory, "global-state", "state.sqlite");
  await mkdir(workspace);
  const controller = new RunController(filename);
  const supervisorPids = new Set<number>();
  const workerPids = new Set<number>();
  const track = (run: RunRecord) => { if (run.supervisorPid) supervisorPids.add(run.supervisorPid); };
  try { await work({ directory, workspace, filename, controller, track }); }
  finally {
    for (const run of controller.store.listRuns()) {
      track(run);
      for (const activation of controller.store.listActivations(run.id)) {
        if (typeof activation.metadata.workerPid === "number") workerPids.add(activation.metadata.workerPid);
      }
      if (!["succeeded", "failed", "cancelled"].includes(run.status)) {
        await controller.control(run.id, "cancel").catch(() => {});
        await until(() => ["succeeded", "failed", "cancelled"].includes(controller.observe(run.id).run.status), 5_000).catch(() => {});
      }
    }
    for (const pid of workerPids) kill(pid, true);
    for (const pid of supervisorPids) if (executing(pid)) kill(pid);
    await until(() => [...workerPids, ...supervisorPids].every(pid => !executing(pid)), 5_000);
    controller.close();
    await rm(directory, { recursive: true, force: true });
  }
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

test("detached pure execution imports generated runtime from an external cwd and persists output", { skip: !posix, timeout: 25_000 }, async () => {
  await fixture(async ({ workspace, controller, track }) => {
    const workflow = flow([{ id: "copy", kind: "transform", value: { op: "ref", path: ["input"] } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "copy"] } }]);
    const run = await controller.start(workflow, { payload: [1, 2, 3] }, workspace);
    track(run);
    const completed = await status(controller, run.id, "succeeded");
    assert.deepEqual(completed.output, { payload: [1, 2, 3] });
    assert.equal(completed.cwd, await realpath(workspace));
    assert.equal(controller.store.listActivations(run.id).length, 2);
    assert.ok(controller.store.listActivations(run.id).every(activation => activation.status === "succeeded"));
    assert.equal(controller.store.events(run.id).at(-1)?.type, "run.succeeded");
    assert.equal(await exists(join(controller.directory(run.id), "supervisor.log")), true);
  });
});

test("check execution survives the launching harness exiting and controller connection closing", { skip: !posix, timeout: 25_000 }, async () => {
  await fixture(async ({ directory, workspace, filename, controller, track }) => {
    const launcherFile = join(directory, "launcher.mjs");
    const runFile = join(directory, "run.json");
    const workflow = flow([waitingCheck("first"), { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "first"] } }]);
    await writeFile(launcherFile, `import {writeFileSync} from 'node:fs';
      import {RunController} from ${JSON.stringify(pathToFileURL(resolve("src/run-controller.ts")).href)};
      const controller=new RunController(${JSON.stringify(filename)});
      try{const run=await controller.start(${JSON.stringify(workflow)},null,${JSON.stringify(workspace)});
      writeFileSync(${JSON.stringify(runFile)},JSON.stringify(run));}finally{controller.close();}`);
    const launcher = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), launcherFile], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    launcher.stderr!.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
    let exited = false;
    let exitCode: number | null = null;
    launcher.once("exit", code => { exited = true; exitCode = code; });
    try {
      await until(() => exited);
      assert.equal(exitCode, 0, stderr);
      const run = JSON.parse(await readFile(runFile, "utf8")) as RunRecord;
      track(run);
      await until(() => exists(join(workspace, "first.pid")));
      const observed = controller.observe(run.id);
      assert.equal(observed.supervisorAlive, true);
      assert.equal(observed.run.status, "running");
      assert.equal(observed.workersAlive, 1);
      await writeFile(join(workspace, "first.release"), "release");
      const completed = await status(controller, run.id, "succeeded");
      assert.deepEqual(completed.output, { exitCode: 0, stdout: "first finished", stderr: "" });
      assert.equal(await readFile(join(workspace, "first.count"), "utf8"), "1\n");
    } finally { if (!exited) { launcher.kill("SIGKILL"); await until(() => exited); } }
  });
});

test("pause drains an active check, blocks the next check and resumes the same supervisor", { skip: !posix, timeout: 25_000 }, async () => {
  await fixture(async ({ workspace, controller, track }) => {
    const run = await controller.start(sequence(), null, workspace);
    track(run);
    await until(() => exists(join(workspace, "first.pid")));
    assert.equal((await controller.control(run.id, "pause")).status, "pausing");
    await delay(150);
    assert.equal(controller.store.get(run.id).status, "pausing");
    assert.equal(await exists(join(workspace, "second.count")), false);
    await writeFile(join(workspace, "first.release"), "release");
    const paused = await status(controller, run.id, "paused");
    assert.equal(paused.supervisorPid, run.supervisorPid);
    assert.equal(paused.ownerToken, run.ownerToken);
    assert.equal(controller.observe(run.id).supervisorAlive, true);
    assert.equal(controller.observe(run.id).workersAlive, 0);
    assert.equal(controller.store.listActivations(run.id).find(a => a.context.nodeId === "first")?.status, "succeeded");
    assert.equal(await exists(join(workspace, "second.count")), false);
    const resumed = await controller.control(run.id, "resume");
    assert.equal(resumed.supervisorPid, run.supervisorPid);
    assert.equal(resumed.ownerToken, run.ownerToken);
    await status(controller, run.id, "succeeded");
    assert.equal(await readFile(join(workspace, "first.count"), "utf8"), "1\n");
    assert.equal(await readFile(join(workspace, "second.count"), "utf8"), "1\n");
  });
});

test("paused supervisor crash is reconciled and replay never repeats a completed check", { skip: !posix, timeout: 30_000 }, async () => {
  await fixture(async ({ workspace, controller, track }) => {
    const run = await controller.start(sequence(), null, workspace);
    track(run);
    await until(() => exists(join(workspace, "first.pid")));
    await controller.control(run.id, "pause");
    await writeFile(join(workspace, "first.release"), "release");
    const paused = await status(controller, run.id, "paused");
    assert.ok(paused.supervisorPid);
    kill(paused.supervisorPid);
    await until(() => !executing(paused.supervisorPid!));
    const interrupted = controller.observe(run.id).run;
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.desired, "paused");
    const resumed = await controller.control(run.id, "resume");
    track(resumed);
    assert.notEqual(resumed.ownerToken, paused.ownerToken);
    assert.notEqual(resumed.supervisorPid, paused.supervisorPid);
    await status(controller, run.id, "succeeded");
    assert.equal(await readFile(join(workspace, "first.count"), "utf8"), "1\n");
    assert.equal(await readFile(join(workspace, "second.count"), "utf8"), "1\n");
    const activations = controller.store.listActivations(run.id);
    assert.equal(activations.find(a => a.context.nodeId === "first")?.attempt, 1);
    assert.equal(controller.store.events(run.id).filter(e => e.type === "run.interrupted").length, 1);
    assert.equal(controller.store.events(run.id).filter(e => e.type === "activation.started" && (e.payload as { key?: string }).key?.includes('"first"')).length, 1);
  });
});

test("run cancellation waits for command and TERM-resistant descendant cleanup before publishing cancelled", { skip: !posix, timeout: 30_000 }, async () => {
  await fixture(async ({ workspace, controller, track }) => {
    const descendantCode = "const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync('descendant.pid',String(process.pid));setInterval(()=>{},1000);";
    const command = `const fs=require('node:fs');const {spawn}=require('node:child_process');process.on('SIGTERM',()=>process.exit(143));
      fs.writeFileSync('command.pid',String(process.pid));spawn(process.execPath,['-e',${JSON.stringify(descendantCode)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
    const run = await controller.start(flow([check("long", command), secondCheck(), { id: "done", kind: "end", value: { op: "literal", value: true } }]), null, workspace);
    track(run);
    let commandPid: number | undefined, descendantPid: number | undefined, workerPid: number | undefined;
    try {
      await until(() => exists(join(workspace, "descendant.pid")));
      commandPid = Number(await readFile(join(workspace, "command.pid"), "utf8"));
      descendantPid = Number(await readFile(join(workspace, "descendant.pid"), "utf8"));
      workerPid = controller.store.listActivations(run.id).find(a => a.context.nodeId === "long")?.metadata.workerPid as number;
      assert.ok(workerPid && executing(commandPid) && executing(descendantPid));
      const requested = await controller.control(run.id, "cancel");
      assert.equal(requested.desired, "cancelled");
      const cancelled = await status(controller, run.id, "cancelled");
      assert.equal(cancelled.output, undefined);
      assert.equal(executing(commandPid), false);
      assert.equal(executing(descendantPid), false);
      assert.equal(executing(workerPid), false);
      assert.equal(await exists(join(workspace, "second.count")), false);
      assert.equal(controller.store.listActivations(run.id).find(a => a.context.nodeId === "long")?.status, "failed");
    } finally {
      if (workerPid) kill(workerPid, true);
      if (commandPid) kill(commandPid);
      if (descendantPid) kill(descendantPid);
    }
  });
});

test("nested parallel and dynamic map drain their check while structural parents remain paused and resumable", { skip: !posix, timeout: 30_000 }, async () => {
  await fixture(async ({ workspace, controller, track }) => {
    const workflow: WorkflowDefinition = {
      schemaVersion: 1, id: "nested", name: "Nested", revision: 1, entryGraph: "main", graphs: {
        main: { entry: "parallel", nodes: [
          { id: "parallel", kind: "parallel", children: [{ id: "left", graphId: "mapped", input: { op: "ref", path: ["input"] } }] },
          { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "parallel"] } },
        ], edges: [{ from: "parallel", to: "done" }] },
        mapped: { entry: "map", nodes: [
          { id: "map", kind: "map", graphId: "leaf", items: { op: "ref", path: ["input"] }, concurrency: 1 },
          { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "map"] } },
        ], edges: [{ from: "map", to: "done" }] },
        leaf: { entry: "mapped", nodes: [waitingCheck("mapped"),
          { id: "done", kind: "end", value: { op: "ref", path: ["input"] } },
        ], edges: [{ from: "mapped", to: "done" }] },
      },
    };
    const run = await controller.start(workflow, ["first item", "second item"], workspace);
    track(run);
    await until(() => exists(join(workspace, "mapped.pid")));
    await controller.control(run.id, "pause");
    await writeFile(join(workspace, "mapped.release"), "release");
    await status(controller, run.id, "paused");
    const pausedRows = controller.store.listActivations(run.id);
    assert.equal(pausedRows.find(a => a.kind === "parallel")?.status, "running");
    assert.equal(pausedRows.find(a => a.kind === "map")?.status, "running");
    assert.equal(pausedRows.filter(a => a.kind === "check").length, 1);
    assert.equal(pausedRows.find(a => a.kind === "check")?.status, "succeeded");
    await controller.control(run.id, "resume");
    const finished = await status(controller, run.id, "succeeded");
    assert.deepEqual(finished.output, { left: ["first item", "second item"] });
    assert.equal(await readFile(join(workspace, "mapped.count"), "utf8"), "1\n1\n");
    const checks = controller.store.listActivations(run.id).filter(a => a.kind === "check");
    assert.equal(checks.length, 2);
    assert.notDeepEqual(checks[0]?.context.scope, checks[1]?.context.scope);
    assert.ok(checks.every(a => a.status === "succeeded" && a.attempt === 1));
  });
});

test("crash during a side-effect check cleans its worker and refuses to replay the uncertain operation", { skip: !posix, timeout: 30_000 }, async () => {
  await fixture(async ({ workspace, controller, track }) => {
    const run = await controller.start(sequence(), null, workspace);
    track(run);
    await until(() => exists(join(workspace, "first.pid")));
    const commandPid = Number(await readFile(join(workspace, "first.pid"), "utf8"));
    const workerPid = controller.store.listActivations(run.id).find(a => a.context.nodeId === "first")?.metadata.workerPid as number;
    assert.ok(run.supervisorPid && workerPid);
    try {
      kill(run.supervisorPid);
      await until(() => !executing(run.supervisorPid!) && !executing(workerPid) && !executing(commandPid));
      const interrupted = controller.observe(run.id).run;
      assert.equal(interrupted.status, "interrupted");
      assert.equal(controller.store.listActivations(run.id).find(a => a.context.nodeId === "first")?.status, "interrupted");
      const resumed = await controller.control(run.id, "resume");
      track(resumed);
      const failed = await status(controller, run.id, "failed");
      assert.match(failed.error ?? "", /Uncertain side effect requires explicit retry authorization/);
      assert.equal(await readFile(join(workspace, "first.count"), "utf8"), "1\n");
      assert.equal(await exists(join(workspace, "second.count")), false);
      const uncertain = controller.store.listActivations(run.id).find(a => a.context.nodeId === "first");
      assert.equal(uncertain?.attempt, 1);
      assert.equal(uncertain?.status, "interrupted");
      assert.equal(failed.output, undefined);
    } finally { kill(workerPid, true); kill(commandPid); }
  });
});

test("concurrent resume commands from separate controllers reserve only one replacement supervisor", { skip: !posix, timeout: 35_000 }, async () => {
  await fixture(async ({ directory, workspace, filename, controller, track }) => {
    const workflow = flow([waitingCheck("first"), waitingCheck("second"), { id: "done", kind: "end", value: { op: "literal", value: "complete" } }]);
    const run = await controller.start(workflow, null, workspace);
    track(run);
    await until(() => exists(join(workspace, "first.pid")));
    await controller.control(run.id, "pause");
    await writeFile(join(workspace, "first.release"), "release");
    const paused = await status(controller, run.id, "paused");
    assert.ok(paused.supervisorPid);
    kill(paused.supervisorPid);
    await until(() => !executing(paused.supervisorPid!));
    assert.equal(controller.observe(run.id).run.status, "interrupted");
    const resumeFile = join(directory, "resumer.mjs");
    await writeFile(resumeFile, `import {RunController} from ${JSON.stringify(pathToFileURL(resolve("src/run-controller.ts")).href)};
      const controller=new RunController(${JSON.stringify(filename)});
      try{const run=await controller.control(${JSON.stringify(run.id)},'resume');process.stdout.write(JSON.stringify({id:run.id,status:run.status}));}
      finally{controller.close();}`);
    const resumers: ReturnType<typeof spawn>[] = [];
    try {
      const results = await Promise.all(Array.from({ length: 8 }, () => new Promise<string>((resolveResult, reject) => {
        const resumer = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), resumeFile], { stdio: ["ignore", "pipe", "pipe"] });
        resumers.push(resumer);
        let output = "", stderr = "";
        const timer = setTimeout(() => { resumer.kill("SIGKILL"); }, 15_000);
        resumer.stdout!.setEncoding("utf8").on("data", (data: string) => { output += data; });
        resumer.stderr!.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
        resumer.once("error", error => { clearTimeout(timer); reject(error); });
        resumer.once("close", code => {
          clearTimeout(timer);
          if (code === 0) resolveResult(output); else reject(new Error(`Concurrent resume exited ${code}: ${stderr}`));
        });
      })));
      assert.equal(results.length, 8);
      for (const result of results) assert.equal((JSON.parse(result) as { id: string }).id, run.id);
      await until(() => exists(join(workspace, "second.pid")));
      const resumed = controller.store.get(run.id);
      track(resumed);
      assert.notEqual(resumed.ownerToken, paused.ownerToken);
      assert.equal(controller.store.events(run.id).filter(e => e.type === "run.reserved").length, 2);
      await writeFile(join(workspace, "second.release"), "release");
      await status(controller, run.id, "succeeded");
      assert.equal(await readFile(join(workspace, "first.count"), "utf8"), "1\n");
      assert.equal(await readFile(join(workspace, "second.count"), "utf8"), "1\n");
    } finally {
      for (const resumer of resumers) if (resumer.exitCode === null && resumer.signalCode === null) resumer.kill("SIGKILL");
      await until(() => resumers.every(resumer => resumer.exitCode !== null || resumer.signalCode !== null), 5_000);
    }
  });
});
