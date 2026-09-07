import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { setup } from "../scripts/setup.js";

async function temp(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-setup-"));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function invoke(executable: string, args: string[], directory: string, request: unknown = {}) {
  const result = spawnSync(executable, args, { cwd: directory, input: JSON.stringify(request), encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

test("setup creates only chosen bin and skill symlinks, repeats idempotently, and executable works from another cwd", async () => {
  await temp(async directory => {
    const binDir = join(directory, "bin with spaces");
    const skillsDir = join(directory, "skills with spaces");
    const result = await setup({ binDir, skillsDir });
    assert.ok((await lstat(result.executable)).isSymbolicLink());
    assert.ok((await lstat(result.skill)).isSymbolicLink());
    assert.equal(await readlink(result.executable), resolve("bin/dynamicwf.mjs"));
    assert.equal(await readlink(result.skill), resolve("skills/dynamic-workflows"));
    assert.match(await readFile(join(result.skill, "SKILL.md"), "utf8"), /^---\nname: dynamic-workflows\n/);
    assert.ok((await setup({ binDir, skillsDir })).links.every(link => link.action === "unchanged"));
    const schema = JSON.parse(invoke(result.executable, ["workflow.schema"], directory));
    assert.equal(schema.ok, true);
    assert.ok(schema.result.workflow && schema.result.patch && schema.result.expression);
    const store = join(directory, "custom.sqlite");
    const created = JSON.parse(invoke(result.executable, ["workflow.create", "--store", store], directory, { id: "test", name: "Installed command" }));
    assert.equal(created.result.id, "test");
    const inspected = JSON.parse(invoke(result.executable, ["workflow.inspect", "--store", store], directory, { id: "test" }));
    assert.equal(inspected.result.name, "Installed command");
    assert.match(invoke(result.executable, ["watch", "--help"], directory), /--run/);
    const help = spawnSync(result.executable, ["mcp", "--help"], { cwd: directory, encoding: "utf8", timeout: 10_000 });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout + help.stderr, /MCP|mcp/);
  });
});

test("setup preflights conflicts without partially installing the other link, and never overwrites a file or directory", async () => {
  await temp(async directory => {
    const binDir = join(directory, "bin");
    const skillsDir = join(directory, "skills");
    await mkdir(skillsDir);
    await writeFile(join(skillsDir, "dynamic-workflows"), "user-owned content");
    await assert.rejects(setup({ binDir, skillsDir }), /Refusing to replace/);
    await assert.rejects(lstat(join(binDir, "dynamicwf")), { code: "ENOENT" });
    await assert.rejects(setup({ binDir, skillsDir, replace: true }), /Refusing to replace/);
    assert.equal(await readFile(join(skillsDir, "dynamic-workflows"), "utf8"), "user-owned content");
    await rm(join(skillsDir, "dynamic-workflows"));
    await mkdir(join(skillsDir, "dynamic-workflows"));
    await assert.rejects(setup({ binDir, skillsDir, replace: true }), /Refusing to replace/);
    assert.ok((await lstat(join(skillsDir, "dynamic-workflows"))).isDirectory());
  });
});

test("explicit replace repoints old/dangling checkout symlinks without modifying their targets", async () => {
  await temp(async directory => {
    const binDir = join(directory, "bin");
    const skillsDir = join(directory, "skills");
    await mkdir(binDir); await mkdir(skillsDir);
    const oldExecutable = join(directory, "old-checkout", "bin", "dynamicwf.mjs");
    const oldSkill = join(directory, "old-checkout", "skills", "dynamic-workflows");
    await symlink(oldExecutable, join(binDir, "dynamicwf"));
    await symlink(oldSkill, join(skillsDir, "dynamic-workflows"));
    await assert.rejects(setup({ binDir, skillsDir }), /Existing symlink points elsewhere/);
    const result = await setup({ binDir, skillsDir, replace: true });
    assert.ok(result.links.every(link => link.action === "replace"));
    assert.equal(await readlink(result.executable), resolve("bin/dynamicwf.mjs"));
    assert.equal(await readlink(result.skill), resolve("skills/dynamic-workflows"));
    await assert.rejects(lstat(oldExecutable), { code: "ENOENT" });
    await assert.rejects(lstat(oldSkill), { code: "ENOENT" });
  });
});

test("setup CLI supports custom directories and does not require the caller's cwd to be the checkout", async () => {
  await temp(async directory => {
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("scripts/setup.ts"),
      "--bin-dir", join(directory, "cli-bin"), "--skills-dir", join(directory, "cli-skills")], { cwd: directory, encoding: "utf8", timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const installed = JSON.parse(result.stdout);
    assert.equal(installed.ok, true);
    assert.equal(installed.executable, join(directory, "cli-bin", "dynamicwf"));
    assert.equal(JSON.parse(invoke(installed.executable, ["catalog.list"], directory)).ok, true);
  });
});

test("installed MCP command negotiates protocol in its own process and exits when client detaches", { timeout: 15_000 }, async () => {
  await temp(async directory => {
    const result = await setup({ binDir: join(directory, "bin"), skillsDir: join(directory, "skills") });
    const transport = new StdioClientTransport({ command: result.executable, args: ["mcp", "--store", join(directory, "mcp.sqlite"), "--cwd", directory], stderr: "pipe" });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const client = new Client({ name: "setup-test", version: "1" });
    let pid: number | null = null;
    try {
      await client.connect(transport);
      pid = transport.pid;
      assert.ok(pid);
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === "workflow_create"));
      const response = await client.callTool({ name: "workflow_create", arguments: { id: "via_mcp", name: "MCP installed" } }) as CallToolResult;
      assert.equal((response.structuredContent as { ok: boolean }).ok, true, stderr);
      // OS argv still identifies the installed executable; there is no child wrapper process.
      assert.match(execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" }), /dynamicwf/);
      const processes = execFileSync("ps", ["-ax", "-o", "ppid=,args="], { encoding: "utf8" });
      assert.equal(processes.split("\n").some(line => line.trim().startsWith(`${pid} `) && /(?:\/src\/mcp\.ts|\/bin\/dynamicwf\.mjs)/.test(line)), false, "No child transport wrapper; esbuild may use its own compiler service");
    } finally { await client.close(); }
    if (pid) {
      const deadline = Date.now() + 3_000;
      while (alive(pid) && Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
      assert.equal(alive(pid), false, "MCP process must exit after detach");
    }
  });
});
