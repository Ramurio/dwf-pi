import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mcpToolDefinitions } from "../src/mcp-tools.js";
import { createOutputValidator } from "../src/output-schema.js";
import { WorkflowService, serviceToolNames } from "../src/service.js";

const executable = fileURLToPath(new URL("../src/mcp.ts", import.meta.url));
type Envelope = { ok: true; result: any } | { ok: false; error: { name: string; message: string; issues?: unknown } };
function envelope(result: CallToolResult): Envelope {
  const value = result.structuredContent as Envelope;
  assert.ok(value && typeof value.ok === "boolean", JSON.stringify(result));
  const text = result.content.find(item => item.type === "text");
  assert.ok(text && text.type === "text");
  assert.deepEqual(JSON.parse(text.text), value);
  return value;
}
async function connect(filename: string, cwd: string, modern = false) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", import.meta.resolve("tsx"), executable, "--store", filename, "--cwd", cwd], stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  const client = new Client({ name: "dynamicwf-integration", version: "1.0.0" }, modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  const protocolErrors: Error[] = [];
  client.onerror = error => protocolErrors.push(error);
  await client.connect(transport);
  return { client, transport, stderr: () => stderr, protocolErrors };
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await client.callTool({ name, arguments: args }) as CallToolResult;
  const value = envelope(response);
  assert.equal(response.isError ?? false, false, JSON.stringify(value));
  assert.equal(value.ok, true, JSON.stringify(value));
  return (value as Extract<Envelope, { ok: true }>).result;
}
async function waitStatus(client: Client, id: string, target: string): Promise<any> {
  const deadline = Date.now() + 20_000;
  let state: any;
  while (Date.now() < deadline) {
    state = await call(client, "run_status", { id });
    if (state.status === target) return state;
    if (["failed", "cancelled", "interrupted"].includes(state.status)) assert.fail(JSON.stringify(state));
    await sleep(50);
  }
  assert.fail(`Timed out waiting for ${target}: ${JSON.stringify(state)}`);
}

test("MCP advertises closed useful schemas for every service operation and full recursive graph patches", () => {
  assert.deepEqual(mcpToolDefinitions.map(tool => tool.serviceTool), [...serviceToolNames]);
  assert.equal(new Set(mcpToolDefinitions.map(tool => tool.name)).size, mcpToolDefinitions.length);
  for (const tool of mcpToolDefinitions) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    const validate = createOutputValidator(tool.inputSchema);
    assert.throws(() => validate({ unexpected: true }), /Invalid structured output/);
  }
  const patch = mcpToolDefinitions.find(tool => tool.name === "workflow_patch")!;
  assert.ok(patch.inputSchema.$defs?.Node);
  assert.ok(patch.inputSchema.$defs?.Expr);
  const validate = createOutputValidator(patch.inputSchema);
  validate({ id: "test", expectedRevision: 1, operations: [{ op: "addNode", graphId: "main", node: { id: "done", kind: "end", value: { op: "select", when: { op: "literal", value: true }, then: { op: "literal", value: 1 }, otherwise: { op: "literal", value: 0 } } } }] });
  assert.throws(() => validate({ id: "test", expectedRevision: "1", operations: [] }), /Invalid structured output/);
  assert.throws(() => validate({ id: "test", expectedRevision: 1, operations: [{ op: "addNode", graphId: "main", node: { id: "bad", kind: "agent", role: "general", task: { op: "literal", value: "Task" }, config: { unknownSetting: true } } }] }), /Invalid structured output/);
  assert.equal(JSON.stringify(patch.inputSchema).includes('"$ref":"Expr"'), false);
});

test("official MCP client initializes, authors and runs; new client inspects and resumes after original closes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dynamicwf-mcp-"));
  const filename = join(cwd, "state.sqlite");
  const connections: Awaited<ReturnType<typeof connect>>[] = [];
  let runId: string | undefined;
  try {
    const first = await connect(filename, cwd); connections.push(first);
    assert.equal(first.client.getServerVersion()?.name, "dynamicwf-pi");
    const listed = await first.client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), mcpToolDefinitions.map(tool => tool.name));
    assert.ok(listed.tools.find(tool => tool.name === "workflow_patch")!.inputSchema.$defs);
    await call(first.client, "workflow_create", { id: "sample", name: "MCP sample" });
    const patched = await call(first.client, "workflow_patch", { id: "sample", expectedRevision: 1, operations: [
      { op: "addNode", graphId: "main", node: { id: "wait", kind: "check", command: process.execPath, args: ["-e", "setTimeout(()=>{}, 400)"] } },
      { op: "addNode", graphId: "main", node: { id: "done", kind: "end", value: { op: "ref", path: ["input"] } } },
      { op: "connect", graphId: "main", edge: { from: "wait", to: "done" } },
    ] });
    assert.equal(patched.validation.valid, true);
    const prepared = await call(first.client, "workflow_prepare", { id: "sample" });
    const started = await call(first.client, "run_start", { preparedId: prepared.preparedId, idempotencyKey: "mcp-sample", input: { from: "first client" } });
    runId = started.id;
    assert.equal(started.planHash, prepared.planHash);
    await call(first.client, "run_pause", { id: runId });
    const paused = await waitStatus(first.client, runId!, "paused");
    assert.equal(paused.supervisorAlive, true);
    await first.client.close();
    const second = await connect(filename, cwd); connections.push(second);
    const inspected = await call(second.client, "run_inspect", { id: runId });
    assert.equal(inspected.status, "paused");
    assert.equal(inspected.supervisorAlive, true);
    assert.equal(inspected.workflow.revision, 2);
    assert.deepEqual(inspected.input, { from: "first client" });
    assert.equal((await call(second.client, "workflow_prepared", { preparedId: prepared.preparedId })).planHash, prepared.planHash);
    const repeated = await call(second.client, "run_start", { preparedId: prepared.preparedId, idempotencyKey: "mcp-sample", input: { from: "first client" } });
    assert.equal(repeated.id, runId);
    assert.equal(repeated.status, "paused");
    await call(second.client, "run_resume", { id: runId });
    const completed = await waitStatus(second.client, runId!, "succeeded");
    assert.deepEqual(completed.output, { from: "first client" });
    const events = await call(second.client, "run_events", { id: runId });
    assert.ok(events.events.some((event: { type: string }) => event.type === "run.succeeded"));
    assert.deepEqual(await call(second.client, "run_events", { id: runId, after: events.nextAfter }), { events: [], nextAfter: events.nextAfter });
    assert.ok((await call(second.client, "run_list")).some((run: { id: string }) => run.id === runId));
    for (const [name, args] of [
      ["workflow_inspect", { id: "sample", typo: true }], ["run_events", { id: runId, after: "0" }],
      ["workflow_patch", { id: "sample", expectedRevision: 1, operations: [{ op: "removeNode", graphId: "main", nodeId: "done" }] }],
      ["workflow_inspect", { id: "missing" }], ["unknown_tool", {}],
    ] as [string, Record<string, unknown>][]) {
      const response = await second.client.callTool({ name, arguments: args }) as CallToolResult;
      assert.equal(response.isError, true);
      const failure = envelope(response); assert.equal(failure.ok, false);
      assert.ok((failure as Extract<Envelope, { ok: false }>).error.message.length > 0);
    }
    for (const connection of connections) assert.deepEqual(connection.protocolErrors, [], connection.stderr());
  } finally {
    for (const connection of connections) await connection.client.close();
    if (runId) {
      const service = new WorkflowService(filename, { cwd });
      try {
        await service.dispatch("run.cancel", { id: runId });
        const deadline = Date.now() + 15_000;
        for (;;) {
          const state = await service.dispatch("run.status", { id: runId }) as { status: string; workersAlive: number };
          if (["cancelled", "succeeded", "failed"].includes(state.status) && state.workersAlive === 0) break;
          if (Date.now() > deadline) assert.fail("MCP integration cleanup did not drain run");
          await sleep(50);
        }
      } finally { service.close(); }
    }
    await rm(cwd, { recursive: true, force: true });
  }
});

test("official v2 client can pin modern stdio while legacy initialize clients remain supported", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dynamicwf-mcp-modern-"));
  const connection = await connect(join(cwd, "state.sqlite"), cwd, true);
  try {
    const tools = await connection.client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === "workflow_create"));
    const roles = await call(connection.client, "catalog_list");
    assert.ok(roles.some((role: { name: string }) => role.name === "reviewer"));
    assert.deepEqual(connection.protocolErrors, [], connection.stderr());
  } finally { await connection.client.close(); await rm(cwd, { recursive: true, force: true }); }
});

test("MCP startup help/errors do not emit banners on protocol stdout", () => {
  for (const arg of ["--help", "--unexpected"]) {
    const child = spawnSync(process.execPath, ["--import", "tsx", executable, arg], { encoding: "utf8", timeout: 15_000 });
    assert.equal(child.status, arg === "--help" ? 0 : 1, child.stderr);
    assert.equal(child.stdout, "");
    assert.ok(child.stderr.length > 0);
  }
});

test("every advertised schema accepts representative arguments without dispatch", () => {
  const hash = "a".repeat(64);
  const preparedId = `prepared-${hash}`;
  const cases: Record<string, Record<string, unknown>> = {};
  for (const name of ["catalog.list", "catalog.models", "system.doctor", "workflow.schema", "workflow.list", "run.list", "preset.list"]) cases[name] = {};
  for (const name of ["workflow.inspect", "workflow.validate", "workflow.compile", "workflow.prepare", "run.start", "run.status", "run.inspect", "run.events", "run.usage", "run.waits", "run.trace", "run.pause", "run.resume", "run.cancel", "run.reconciliations", "run.continuation.inspect", "task.inspect", "task.usage"]) cases[name] = { id: "demo" };
  for (const name of ["run.recovery", "run.retries", "run.collections", "run.attempts"]) cases[name] = { id: "demo", key: "main/done" };
  cases["catalog.describe"] = { name: "general" };
  cases["workflow.create"] = { id: "demo", name: "Demo" };
  cases["workflow.patch"] = { id: "demo", expectedRevision: 1, operations: [{ op: "addGraph", graphId: "child" }] };
  cases["workflow.prepared"] = { preparedId };
  cases["run.resolve"] = { id: "demo", waitId: "wait", response: { $ref: "data" } };
  cases["preset.save"] = { id: "demo", name: "example" };
  cases["preset.inspect"] = cases["preset.run"] = { name: "example" };
  cases["run.reconcile"] = { id: "demo", key: "main/done", attempt: 1, checkpoint: hash, workspaceDigest: hash, decisionId: "decision", action: "accept", actor: "reviewer", reason: "verified", evidence: ["offline"], output: null };
  cases["run.continue"] = { preparedId, idempotencyKey: "continuation", source: { runId: "demo", checkpoint: hash, planHash: hash }, actor: "reviewer", reason: "revised", evidence: ["offline"], workspaceDigest: hash };
  assert.deepEqual(Object.keys(cases).sort(), [...serviceToolNames].sort());
  for (const tool of mcpToolDefinitions) assert.doesNotThrow(() => createOutputValidator(tool.inputSchema)(cases[tool.serviceTool]), tool.serviceTool);
});
