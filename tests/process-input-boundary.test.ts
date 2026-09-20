import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { matchesProcess } from "../src/run-controller.js";
import { drainedChild } from "./helpers/drained-child.js";

test("check worker preserves Unicode split between stdin writes", { timeout: 15_000 }, async t => {
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/check-worker-process.ts", import.meta.url))], { detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const done = drainedChild(child);
  let output = ""; child.stdout!.setEncoding("utf8").on("data", value => { output += value; }); child.stderr!.resume();
  const value = "Привет 🕷️ 中文";
  const bytes = Buffer.from(JSON.stringify({ command: process.execPath, args: ["-e", "process.stdout.write(process.argv[1])", value], cwd: process.cwd() }));
  const offset = bytes.indexOf(Buffer.from(value)) + 1;
  child.stdin!.write(bytes.subarray(0, offset));
  await new Promise(resolve => setTimeout(resolve, 300));
  child.stdin!.end(bytes.subarray(offset));
  assert.equal(await done, 0);
  assert.equal(JSON.parse(output).stdout, value);
});

test("process identity ignores observer C locale for Unicode arguments", { skip: process.platform === "win32", timeout: 10_000 }, async t => {
  const marker = "уникальный-процесс-🕷️";
  const script = "setInterval(()=>{},1000)";
  const child = spawn(process.execPath, ["-e", script, marker], { stdio: "ignore" });
  const done = drainedChild(child);
  const previous = process.env.LC_ALL;
  try {
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    process.env.LC_ALL = "C";
    assert.equal(matchesProcess(child.pid!, marker, script), true);
  } finally {
    if (previous === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = previous;
    child.kill("SIGTERM"); await done;
  }
});

test("test settlement retains late stdout/stderr without requiring child.close", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let out = "", err = "", resolved = false;
  child.stdout.on("data", (b: Buffer) => { out += b; }); child.stderr.on("data", (b: Buffer) => { err += b; });
  const done = drainedChild(child).then(code => { resolved = true; return code; });
  child.emit("exit", 130);
  await Promise.resolve(); assert.equal(resolved, false);
  child.stdout.end('ready\nerror\n'); child.stderr.end("late forbidden marker");
  assert.equal(await done, 130);
  assert.equal(out, 'ready\nerror\n'); assert.match(err, /forbidden marker/);
});
