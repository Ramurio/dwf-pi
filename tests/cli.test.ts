import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("separate CLI processes author, persist, inspect and compile a workflow without writing orchestration code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-cli-"));
  const store = join(directory, "state.sqlite");
  const call = (tool: string, input: unknown, status = 0) => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", tool, "--store", store], {
      input: JSON.stringify(input), encoding: "utf8", timeout: 15_000,
    });
    assert.equal(child.status, status, child.stderr + child.stdout);
    return JSON.parse(child.stdout) as { ok: boolean; result: Record<string, any>; error?: { message: string } };
  };
  try {
    assert.equal(call("workflow.create", { id: "demo", name: "Demo" }).result.revision, 1);
    const patch = call("workflow.patch", { id: "demo", expectedRevision: 1, operations: [
      { op: "addNode", graphId: "main", node: { id: "prepare", kind: "transform", value: { op: "ref", path: ["input"] } } },
      { op: "addNode", graphId: "main", node: { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "prepare"] } } },
      { op: "connect", graphId: "main", edge: { from: "prepare", to: "done" } },
    ] });
    assert.equal(patch.result.validation.valid, true);
    assert.equal(call("workflow.inspect", { id: "demo" }).result.revision, 2);
    const compiled = call("workflow.compile", { id: "demo" });
    assert.match(compiled.result.source, /Effect\.gen/);
    assert.match(compiled.result.source, /switch/);
    assert.match(compiled.result.hash, /^[a-f0-9]{64}$/);
    assert.equal(call("workflow.compile", { id: "demo" }).result.hash, compiled.result.hash);
    assert.equal(call("workflow.patch", { id: "demo", expectedRevision: 1, operations: [] }, 1).ok, false);
    assert.equal(call("workflow.inspect", { id: "demo" }).result.revision, 2);
    assert.equal(call("workflow.inspect", { id: "demo", unexpected: true }, 1).ok, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("CLI reads a large UTF-8 JSON request from a delayed, chunked pipe through EOF", { timeout: 15_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-cli-pipe-"));
  const child = spawn(process.execPath, ["bin/dynamicwf.mjs", "workflow.create", "--store", join(directory, "state.sqlite")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  let stdout = "";
  let stderr = "";
  let inputError: Error | undefined;
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  child.stdin.on("error", error => { inputError = error; });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const name = "Исследование 🕷️ ".repeat(12_000);
  const bytes = Buffer.from(JSON.stringify({ id: "chunked", name }));
  // Let the CLI reach stdin before input exists; split inside UTF-8 characters too.
  await delay(750);
  for (let offset = 0; offset < bytes.length && child.exitCode === null && !inputError; offset += 4093) {
    child.stdin.write(bytes.subarray(offset, offset + 4093));
    await delay(5);
  }
  await delay(50);
  assert.equal(stdout, "", "CLI must wait for EOF before dispatching");
  child.stdin.end();
  assert.equal(await closed, 0, stderr + stdout);
  assert.equal(inputError, undefined);
  const response = JSON.parse(stdout);
  assert.equal(response.ok, true);
  assert.equal(response.result.name, name);
  assert.equal(response.result.revision, 1);
});
