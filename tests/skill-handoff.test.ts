import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createOutputValidator } from "../src/output-schema.js";

for (const transport of ["CLI", "MCP"]) test(`${transport}: offline scripted skill handoff and error envelopes`, { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-handoff-"));
  const store = join(directory, "state.sqlite");
  const records: unknown[] = [];
  let client: Client | undefined;
  let runId: string | undefined;
  const call = async (tool: string, input: Record<string, unknown> = {}, ok = true): Promise<any> => {
    let value: any;
    if (client) {
      const raw = await client.callTool({ name: tool.replaceAll(".", "_"), arguments: input }) as CallToolResult;
      value = raw.structuredContent;
      const text = raw.content.find(item => item.type === "text");
      assert.ok(text && text.type === "text");
      assert.deepEqual(JSON.parse(text.text), value);
      assert.equal(raw.isError ?? false, !ok);
      records.push({ tool, input, raw });
    } else {
      const raw = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", tool, "--store", store], { input: JSON.stringify(input), encoding: "utf8", timeout: 15000 });
      assert.equal(raw.status, ok ? 0 : 1, raw.stderr + raw.stdout);
      value = JSON.parse(raw.stdout);
      records.push({ tool, input, stdout: raw.stdout, status: raw.status });
    }
    assert.equal(value.ok, ok, JSON.stringify(value));
    return ok ? value.result : value.error;
  };
  try {
    if (transport === "MCP") {
      client = new Client({ name: "offline-handoff", version: "1" });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("src/mcp.ts"), "--store", store, "--cwd", directory], stderr: "pipe" }));
    }
    const schemas = await call("workflow.schema");
    if (client) {
      const listed = await client.listTools();
      records.push(listed);
      assert.deepEqual(schemas.patch, listed.tools.find(tool => tool.name === "workflow_patch")!.inputSchema);
    }
    await call("workflow.create", { id: "demo", name: "Offline handoff" });
    const request = { id: "demo", expectedRevision: 1, operations: [
      { op: "addNode", graphId: "main", node: { id: "answer", kind: "await", reason: { op: "literal", value: "Offline input" }, input: { op: "literal", value: null }, responseSchema: { type: "object", properties: {}, additionalProperties: false } } },
      { op: "addNode", graphId: "main", node: { id: "done", kind: "end", value: { op: "literal", value: "done" } } },
      { op: "connect", graphId: "main", edge: { from: "answer", to: "done" } },
    ] };
    createOutputValidator(schemas.patch)(request);
    const { id: _, ...missingId } = request;
    await call("workflow.patch", missingId, false);
    assert.equal((await call("workflow.patch", request)).validation.valid, true);
    const conflict = await call("workflow.patch", request, false);
    assert.equal(conflict.expectedRevision, 1);
    assert.equal(conflict.actualRevision, 2);
    const failure = await call("workflow.patch", { id: "demo", expectedRevision: 2, operations: [
      { op: "addGraph", graphId: "rolledBack" },
      { op: "removeNode", graphId: "main", nodeId: "missing" },
    ] }, false);
    assert.equal(failure.operationIndex, 1);
    const unchanged = await call("workflow.inspect", { id: "demo" });
    assert.equal(unchanged.revision, 2);
    assert.equal(unchanged.graphs.rolledBack, undefined);
    assert.equal((await call("workflow.validate", { id: "demo" })).valid, true);
    const prepared = await call("workflow.prepare", { id: "demo", cwd: directory });
    const start = { preparedId: prepared.preparedId, idempotencyKey: "offline-first-start", input: null };
    const started = await call("run.start", start);
    runId = started.id;
    assert.match(runId!, /^[A-Za-z][A-Za-z0-9_-]+$/);
    assert.equal(started.planHash, prepared.planHash);
    // First status is obtained immediately, before any completion polling.
    const first = await call("run.status", { id: runId });
    assert.equal(first.id, runId);
    assert.ok(["running", "waiting", "starting"].includes(first.status), JSON.stringify(first));
    assert.equal((await call("run.start", start)).id, runId);
    const evidence = join(directory, "envelopes.json");
    await writeFile(evidence, JSON.stringify(records));
    assert.deepEqual(JSON.parse(await readFile(evidence, "utf8")), records);
  } finally {
    if (runId) {
      await call("run.cancel", { id: runId });
      const deadline = Date.now() + 15000;
      for (;;) {
        const state = await call("run.status", { id: runId });
        if (state.status === "cancelled" && state.workersAlive === 0) break;
        assert.ok(Date.now() < deadline, "cleanup must drain run");
        await sleep(50);
      }
    }
    await client?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
