import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ProcessCancelled, runCheckProcess, runPiProcess } from "../src/process-client.js";

import type { PiWorkerRequest } from "../src/execution-types.js";

const posix = process.platform !== "win32";
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function bounded<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Process test exceeded ${ms}ms`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function executing(pid: number): boolean {
  try { process.kill(pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
  try { return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().startsWith("Z"); }
  catch { return false; }
}
async function until(predicate: () => boolean | Promise<boolean>, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(`Condition was not met within ${ms}ms`);
}
async function marker(path: string): Promise<number> {
  let pid: number | undefined;
  await until(async () => {
    try { pid = Number(await readFile(path, "utf8")); return Number.isSafeInteger(pid) && pid > 0; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  });
  return pid!;
}
function kill(pid: number, group = false): void {
  try { process.kill(group ? -pid : pid, "SIGKILL"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
async function temp(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-process-"));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function fixtureCommand(directory: string, resistant = false): string {
  const grandchild = `const fs=require('node:fs'); ${resistant ? "process.on('SIGTERM',()=>{});" : ""}
    fs.writeFileSync(${JSON.stringify(join(directory, "descendant.pid"))},String(process.pid));setInterval(()=>{},1000);`;
  return `const fs=require('node:fs');const {spawn}=require('node:child_process');
    process.on('SIGTERM',()=>process.exit(143));
    fs.writeFileSync(${JSON.stringify(join(directory, "command.pid"))},String(process.pid));
    spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});
    setInterval(()=>{},1000);`;
}

test("check arguments stay literal without shell expansion, cwd is honored and nonzero exits are data", { timeout: 15_000 }, async () => {
  await temp(async directory => {
    const literal = "$(touch should-not-exist); `uname` $HOME * a b";
    const result = await bounded(runCheckProcess(process.execPath, ["-e", "process.stdout.write(JSON.stringify({arg:process.argv[1],cwd:process.cwd()}));process.stderr.write('check diagnostic');process.exitCode=7", literal], directory));
    assert.deepEqual(result, { exitCode: 7, stdout: JSON.stringify({ arg: literal, cwd: await realpath(directory) }), stderr: "check diagnostic" });
    await assert.rejects(readFile(join(directory, "should-not-exist")), { code: "ENOENT" });
  });
});

test("pre-aborted checks never admit a process", async () => {
  const controller = new AbortController();
  controller.abort();
  let admitted = false;
  await assert.rejects(runCheckProcess(process.execPath, ["-e", "process.exit(0)"], process.cwd(), {
    signal: controller.signal, onStarted: () => { admitted = true; },
  }), ProcessCancelled);
  assert.equal(admitted, false);
});

test("worker reservation precedes spawn and PID persistence precedes sending either execution request", { skip: !posix, timeout: 20_000 }, async () => {
  await temp(async directory => {
    const preload = join(directory, "admission.cjs"), ready = join(directory, "ready"), received = join(directory, "received");
    // Keep the wrapper event loop alive while its parent is deliberately blocked
    // inside the synchronous checkpoint callback. No provider is loaded or called.
    await writeFile(preload, `const fs=require('node:fs');process.stdin.on('data',()=>fs.writeFileSync(${JSON.stringify(received)},'payload'));setTimeout(()=>fs.writeFileSync(${JSON.stringify(ready)},'ready'),100);`);
    const previous = process.env.NODE_OPTIONS;
    try {
      process.env.NODE_OPTIONS = `--require=${preload}`;
      for (const kind of ["check", "pi"] as const) {
        const run = (options: Parameters<typeof runCheckProcess>[3]): Promise<unknown> => kind === "check"
          ? runCheckProcess(process.execPath, ["-e", "process.exit(0)"], directory, options)
          : runPiProcess({ version: 999, cwd: directory } as unknown as PiWorkerRequest, options);
        let spawned = false;
        await assert.rejects(run({ onStarting: () => { throw new Error("reservation rejected"); }, onStarted: () => { spawned = true; } }), /reservation rejected/);
        assert.equal(spawned, false); assert.equal(existsSync(ready), false);
        let reserved: string | undefined, wrapper: number | undefined;
        try {
          await assert.rejects(bounded(run({
            onStarting: identity => { reserved = identity; },
            onStarted: pid => {
              wrapper = pid; assert.ok(reserved);
              assert.ok(execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" }).includes(`--worker-token ${reserved}`));
              const deadline = Date.now() + 5_000;
              while (!existsSync(ready) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
              assert.ok(existsSync(ready), "wrapper must initialize during the blocked checkpoint");
              assert.equal(existsSync(received), false, "no execution payload before the PID checkpoint");
              throw new Error("PID checkpoint rejected");
            },
          })), /PID checkpoint rejected/);
          assert.ok(wrapper); await until(() => !executing(wrapper!));
          assert.equal(existsSync(received), false);
        } finally { if (wrapper) kill(wrapper, true); await rm(ready, { force: true }); await rm(received, { force: true }); }
      }
    } finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
  });
});

test("cancellation immediately after wrapper admission settles and reaps its process group", { skip: !posix, timeout: 15_000 }, async () => {
  const controller = new AbortController();
  let wrapper: number | undefined;
  try {
    await assert.rejects(bounded(runCheckProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd(), {
      identity: "test-immediate-abort", signal: controller.signal,
      onStarted: pid => { wrapper = pid; controller.abort(); },
    })), ProcessCancelled);
    assert.ok(wrapper);
    await until(() => !executing(wrapper!));
  } finally { if (wrapper) kill(wrapper, true); }
});

test("supervisor death during the PID checkpoint closes either worker without sending its task", { skip: !posix, timeout: 20_000 }, async () => {
  for (const kind of ["check", "pi"] as const) await temp(async directory => {
    const ready = join(directory, "wrapper.pid"), received = join(directory, "received"), reserved = join(directory, "reserved"), parentFile = join(directory, "parent.mjs");
    const preload = join(directory, "waiting.cjs");
    await writeFile(preload, `if(process.argv[1]?.endsWith('-worker-process.ts')){const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));process.stdin.on('data',()=>fs.writeFileSync(${JSON.stringify(received)},'payload'));}`);
    await writeFile(parentFile, `import {writeFileSync} from 'node:fs';import {runCheckProcess,runPiProcess} from ${JSON.stringify(pathToFileURL(resolve("src/process-client.ts")).href)};
      const options={onStarting:identity=>writeFileSync(${JSON.stringify(reserved)},identity),onStarted:()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)};
      await ${kind === "check" ? `runCheckProcess(process.execPath,['-e','process.exit(0)'],${JSON.stringify(directory)},options)` : `runPiProcess({version:999,cwd:${JSON.stringify(directory)}},options)`};`);
    const parent = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), parentFile], { cwd: directory, env: { ...process.env, NODE_OPTIONS: `--require=${preload}` }, stdio: "ignore" });
    let exited = false, wrapper: number | undefined; parent.once("exit", () => { exited = true; });
    try {
      wrapper = await marker(ready);
      const identity = await readFile(reserved, "utf8");
      assert.ok(execFileSync("ps", ["-p", String(wrapper), "-o", "args="], { encoding: "utf8" }).includes(`--worker-token ${identity}`));
      assert.equal(existsSync(received), false);
      parent.kill("SIGKILL"); await until(() => exited); await until(() => !executing(wrapper!));
      assert.equal(existsSync(received), false);
    } finally {
      if (parent.pid && !exited) { parent.kill("SIGKILL"); await until(() => exited); }
      if (wrapper) kill(wrapper, true);
    }
  });
});

test("post-admission cancellation kills command and ordinary descendants", { skip: !posix, timeout: 20_000 }, async () => {
  await temp(async directory => {
    const controller = new AbortController();
    let wrapper: number | undefined, command: number | undefined, descendant: number | undefined;
    const promise = runCheckProcess(process.execPath, ["-e", fixtureCommand(directory)], directory, {
      identity: "test-descendant-abort", signal: controller.signal, onStarted: pid => { wrapper = pid; },
    });
    // Attach a rejection handler before waiting for process admission markers.
    const settled = promise.then(value => ({ value }), error => ({ error }));
    try {
      command = await marker(join(directory, "command.pid"));
      descendant = await marker(join(directory, "descendant.pid"));
      assert.ok(wrapper && executing(wrapper) && executing(command) && executing(descendant));
      const args = execFileSync("ps", ["-o", "args=", "-p", String(wrapper)], { encoding: "utf8" });
      assert.match(args, /--worker-token test-descendant-abort/);
      controller.abort();
      const result = await bounded(settled);
      assert.ok("error" in result && result.error instanceof ProcessCancelled);
      await until(() => !executing(wrapper!) && !executing(command!) && !executing(descendant!));
    } finally {
      controller.abort();
      if (wrapper) kill(wrapper, true);
      if (command) kill(command);
      if (descendant) kill(descendant);
      await bounded(settled).catch(() => {});
    }
  });
});

test("cancellation escalates for a TERM-resistant descendant after its immediate parent exits", { skip: !posix, timeout: 20_000 }, async () => {
  await temp(async directory => {
    const controller = new AbortController();
    let wrapper: number | undefined, command: number | undefined, descendant: number | undefined;
    const settled = runCheckProcess(process.execPath, ["-e", fixtureCommand(directory, true)], directory, {
      identity: "test-resistant-descendant", signal: controller.signal, onStarted: pid => { wrapper = pid; },
    }).then(value => ({ value }), error => ({ error }));
    try {
      command = await marker(join(directory, "command.pid"));
      descendant = await marker(join(directory, "descendant.pid"));
      controller.abort();
      const result = await bounded(settled);
      assert.ok("error" in result && result.error instanceof ProcessCancelled);
      await until(() => !executing(descendant!) && !executing(command!) && !executing(wrapper!));
    } finally {
      controller.abort();
      if (wrapper) kill(wrapper, true);
      if (command) kill(command);
      if (descendant) kill(descendant);
      await bounded(settled).catch(() => {});
    }
  });
});

for (const resistant of [false, true]) test(`supervisor death disconnects check IPC and terminates wrapper, command and ${resistant ? "TERM-resistant" : "ordinary"} descendants`, { skip: !posix, timeout: 20_000 }, async () => {
  await temp(async directory => {
    const fixture = join(directory, "supervisor.mjs");
    await writeFile(fixture, `import {writeFileSync} from 'node:fs';
      import {runCheckProcess} from ${JSON.stringify(pathToFileURL(resolve("src/process-client.ts")).href)};
      await runCheckProcess(process.execPath,['-e',${JSON.stringify(fixtureCommand(directory, resistant))}],${JSON.stringify(directory)}, {
        identity:'test-parent-death', onStarted:pid=>writeFileSync(${JSON.stringify(join(directory, "wrapper.pid"))},String(pid))
      });`);
    const supervisor: ChildProcess = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), fixture], { stdio: "ignore" });
    let wrapper: number | undefined, command: number | undefined, descendant: number | undefined;
    const supervisorExit = new Promise<void>((resolveExit, reject) => {
      supervisor.once("error", reject); supervisor.once("exit", () => resolveExit());
    });
    try {
      wrapper = await marker(join(directory, "wrapper.pid"));
      command = await marker(join(directory, "command.pid"));
      descendant = await marker(join(directory, "descendant.pid"));
      assert.ok(executing(wrapper) && executing(command) && executing(descendant));
      supervisor.kill("SIGKILL");
      await bounded(supervisorExit);
      await until(() => !executing(wrapper!) && !executing(command!) && !executing(descendant!));
    } finally {
      supervisor.kill("SIGKILL");
      if (wrapper) kill(wrapper, true);
      if (command) kill(command);
      if (descendant) kill(descendant);
      await bounded(supervisorExit).catch(() => {});
    }
  });
});

test("check spawn errors and onStarted callback failures settle without orphaning the wrapper", { skip: !posix, timeout: 15_000 }, async () => {
  await assert.rejects(bounded(runCheckProcess("/nonexistent/dynamicwf-command", [], process.cwd())), /ENOENT/);
  let wrapper: number | undefined;
  try {
    await assert.rejects(bounded(runCheckProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd(), {
      onStarted: pid => { wrapper = pid; throw new Error("metadata write failed"); },
    })), /metadata write failed/);
    assert.ok(wrapper);
    await until(() => !executing(wrapper!));
  } finally { if (wrapper) kill(wrapper, true); }
});


test("pi process rejects an unsupported protocol version before loading credentials or admitting a model", { skip: !posix, timeout: 15_000 }, async () => {
  let wrapper: number | undefined;
  const request = { version: 999, cwd: process.cwd() } as unknown as PiWorkerRequest;
  try {
    await assert.rejects(bounded(runPiProcess(request, {
      identity: "test-pi-invalid-version", onStarted: pid => { wrapper = pid; },
    })), /Unsupported pi worker request version/);
    assert.ok(wrapper);
    await until(() => !executing(wrapper!));
    const controller = new AbortController();
    controller.abort();
    let admitted = false;
    await assert.rejects(runPiProcess(request, { signal: controller.signal, onStarted: () => { admitted = true; } }), ProcessCancelled);
    assert.equal(admitted, false);
  } finally { if (wrapper) kill(wrapper, true); }
});

test("unhandled pi bootstrap stderr never leaks into the public worker error", { skip: !posix, timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-stderr-"));
  const preload = join(directory, "failure.cjs");
  const previous = process.env.NODE_OPTIONS;
  const secret = "FAKE_PROVIDER_HEADER_DO_NOT_FORWARD";
  await writeFile(preload, `process.stderr.write(${JSON.stringify(secret)}); process.exit(7);`);
  let wrapper: number | undefined;
  try {
    process.env.NODE_OPTIONS = `--require=${preload}`;
    await assert.rejects(bounded(runPiProcess({ version: 999, cwd: directory } as unknown as PiWorkerRequest, {
      onStarted: pid => { wrapper = pid; },
    })), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Pi worker exited 7/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    if (wrapper && executing(wrapper)) kill(wrapper, true);
    await rm(directory, { recursive: true, force: true });
  }
});
