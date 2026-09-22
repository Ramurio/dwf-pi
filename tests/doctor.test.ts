import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { diagnoseSystem } from "../src/doctor.js";
import { WorkflowService, serviceToolNames } from "../src/service.js";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
import type { AvailableExecutionModel } from "../src/execution-plan.js";
const models: AvailableExecutionModel[] = [{ provider: "test-provider", id: "test-model", thinkingLevels: ["off", "high"] }, { provider: "xai", id: "grok-test", thinkingLevels: ["low"] }];
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-doctor-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, "workspace"); await mkdir(cwd);
  return { directory, cwd, filename: join(directory, "state", "state.sqlite") };
}

test("doctor checks local prerequisites and keeps missing state location uncreated", async t => {
  const f = await fixture(t); const before = await readdir(f.directory);
  const result = await diagnoseSystem({ ...f, availableModels: models, nodeVersion: "v22.19.0", platform: "linux" });
  assert.deepEqual(result.readyFor, { pureRuns: true, agentRuns: true, grok: true, workspaceWrites: true });
  assert.deepEqual(result.models, models); assert.deepEqual(result.issues, []);
  assert.ok(result.checks.some(check => check.id === "git"));
  assert.equal(result.checks.find(check => check.id === "sdk-patches")?.status, "ok");
  assert.match(result.checks.find(check => check.id === "authenticated-models")!.detail, /credentials were not inspected/);
  assert.deepEqual(await readdir(f.directory), before);
});

test("doctor does not modify existing state content or create SQLite sidecars", async t => {
  const f = await fixture(t); await mkdir(join(f.directory, "state"));
  const bytes = Buffer.from("existing state content must remain unchanged\0"); await writeFile(f.filename, bytes);
  const before = await readdir(join(f.directory, "state"));
  const result = await diagnoseSystem({ ...f, availableModels: [] });
  assert.equal(result.checks.find(check => check.id === "persistent-state")!.status, "ok");
  assert.deepEqual(await readFile(f.filename), bytes);
  assert.deepEqual(await readdir(join(f.directory, "state")), before);
  assert.equal(result.readyFor.pureRuns, process.platform !== "win32");
  assert.equal(result.readyFor.agentRuns, false); assert.equal(result.readyFor.grok, false);
});

const supportedVersions = [
  "22.19.0", "22.20.0", "23.0.0", "v22.19.0", "22.19.1",
  "22.19.0+build.1", "v22.19.0+sha-abc.001", "23.0.0+rc.1",
];
const unsupportedVersions = [
  "22.18.999", "21.0.0", "21.99.99", "21.x", "", "unknown", "22.19",
  "22.19.0-rc.1", "23.0.0-rc.1", "v24.0.0-nightly.1", "23.0.0-rc.1+build.7",
  "22.18.999+build.1", "22.19.0+", "22.19.0-", "22.19.0+build..meta",
  "22.19.0+build.", "22.19.0+build_meta", "22.19.0+build+extra", "22.19.0junk",
  " 22.19.0", "22.19.0 ", "22.19.0\n", "22.19.0\r\n", "22.19.0+build.1\n",
  "vv22.19.0", "V22.19.0", "022.19.0", "22.019.0", "22.19.00",
];
for (const [versions, supported] of [[supportedVersions, true], [unsupportedVersions, false]] as const) {
  for (const nodeVersion of versions) {
    test(`doctor stable Node version ${JSON.stringify(nodeVersion)} is ${supported ? "supported" : "unavailable"}`, async t => {
      const f = await fixture(t); const stateDirectory = join(f.directory, "state");
      await mkdir(stateDirectory);
      const bytes = Buffer.from("existing state must remain unchanged\0"); await writeFile(f.filename, bytes);
      const before = await readdir(stateDirectory); const rootBefore = await readdir(f.directory);
      const result = await diagnoseSystem({ ...f, nodeVersion, platform: "linux", availableModels: models });
      assert.equal(result.store, f.filename);
      assert.deepEqual(result.models, models);
      assert.deepEqual(result.issues, []);
      assert.deepEqual(await readFile(f.filename), bytes);
      assert.deepEqual(await readdir(stateDirectory), before);
      assert.deepEqual(await readdir(f.directory), rootBefore);
      assert.equal(result.checks.find(check => check.id === "node")!.status, supported ? "ok" : "unavailable");
      assert.deepEqual(result.readyFor, { pureRuns: supported, agentRuns: supported, grok: supported, workspaceWrites: supported });
    });
  }
}

test("doctor distinguishes unsupported Node, platform, missing workspace and nonpersistent state", async t => {
  const f = await fixture(t);
  const oldNode = await diagnoseSystem({ ...f, availableModels: models, nodeVersion: "22.18.0", platform: "linux" });
  assert.equal(oldNode.checks.find(check => check.id === "node")!.status, "unavailable"); assert.equal(oldNode.readyFor.pureRuns, false);
  const windows = await diagnoseSystem({ ...f, availableModels: models, platform: "win32" });
  assert.equal(windows.checks.find(check => check.id === "process-groups")!.status, "unavailable"); assert.equal(windows.readyFor.agentRuns, false);
  const absent = await diagnoseSystem({ ...f, cwd: join(f.directory, "missing"), availableModels: [] });
  assert.equal(absent.checks.find(check => check.id === "workspace")!.status, "unavailable"); assert.equal(absent.readyFor.pureRuns, false);
  const memory = await diagnoseSystem({ ...f, filename: ":memory:", availableModels: models });
  assert.equal(memory.checks.find(check => check.id === "persistent-state")!.status, "unavailable"); assert.equal(memory.readyFor.pureRuns, false);
});

test("directory state path and file-as-parent cannot be advertised as writable database paths", async t => {
  const f = await fixture(t); await writeFile(join(f.directory, "not-a-directory"), "keep");
  for (const filename of [f.cwd, join(f.directory, "not-a-directory", "state.sqlite")]) {
    const result = await diagnoseSystem({ ...f, filename, availableModels: models });
    assert.equal(result.checks.find(check => check.id === "persistent-state")!.status, "unavailable"); assert.equal(result.readyFor.pureRuns, false);
  }
});

test("service exposes model/doctor tools using injected models even with refresh requested", async t => {
  const f = await fixture(t); const service = new WorkflowService(f.filename, { cwd: f.cwd, availableModels: models }); t.after(() => service.close());
  const first = await service.dispatch("catalog.models", {}) as { models: AvailableExecutionModel[]; issues: string[] };
  assert.deepEqual(first, { models, issues: [] }); first.models[0]!.id = "mutated";
  assert.deepEqual(await service.dispatch("catalog.models", { refresh: true }), { models, issues: [] });
  const result = await service.dispatch("system.doctor", {}) as Awaited<ReturnType<typeof diagnoseSystem>>;
  assert.deepEqual(result.models, models); assert.equal(result.cwd, f.cwd); assert.equal(result.store, f.filename);
  assert.deepEqual(await readdir(f.directory), ["workspace"]);
  const relative = await service.dispatch("system.doctor", { cwd: "absent" }) as Awaited<ReturnType<typeof diagnoseSystem>>;
  assert.equal(relative.cwd, join(f.cwd, "absent")); assert.equal(relative.readyFor.pureRuns, false);
  await assert.rejects(service.dispatch("catalog.models", { refresh: "yes" }), /boolean refresh/);
  await assert.rejects(service.dispatch("catalog.models", { apiKey: "DO_NOT_DISCLOSE" }), /Unexpected/);
  await assert.rejects(service.dispatch("system.doctor", { refresh: true }), /Unexpected/);
  await assert.rejects(service.dispatch("system.doctor", { cwd: "bad\0path" }), /without NUL/);
});

test("MCP publishes closed schemas with distinct catalog refresh and cache-only doctor behavior", () => {
  assert.ok(serviceToolNames.includes("catalog.models")); assert.ok(serviceToolNames.includes("system.doctor"));
  const catalog = mcpToolDefinitions.find(tool => tool.name === "catalog_models")!;
  const doctor = mcpToolDefinitions.find(tool => tool.name === "system_doctor")!;
  assert.equal(catalog.inputSchema.additionalProperties, false); assert.equal(doctor.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(catalog.inputSchema.properties), ["refresh"]); assert.deepEqual(Object.keys(doctor.inputSchema.properties), ["cwd"]);
  assert.equal(catalog.annotations.openWorldHint, true); assert.equal(doctor.annotations.openWorldHint, false);
});
