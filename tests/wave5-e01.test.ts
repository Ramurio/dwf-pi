import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/mcp.js";

const failingOperations = [
  { op: "addGraph", graphId: "researcher" },
  { op: "addGraph", graphId: "main" },
];

type Envelope = {
  ok: boolean;
  result?: { revision?: number };
  error?: {
    name: string;
    message: string;
    operationIndex?: number;
    expectedRevision?: number;
    actualRevision?: number;
  };
};

function cli(store: string, tool: string, input: unknown, status = 0): Envelope {
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", tool, "--store", store], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 15_000,
  });
  assert.equal(child.status, status, child.stderr + child.stdout);
  return JSON.parse(child.stdout) as Envelope;
}

function assertPatchLocatesDuplicateMain(envelope: Envelope): void {
  assert.equal(envelope.ok, false, JSON.stringify(envelope));
  assert.equal(envelope.error?.name, "AuthoringError");
  assert.match(envelope.error?.message ?? "", /Graph already exists: main/);
  assert.equal(envelope.error?.operationIndex, 1);
}

test("CLI graph patch names the failing operation and keeps the draft at revision 1", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-e01-cli-"));
  const store = join(directory, "state.sqlite");
  try {
    assert.equal(cli(store, "workflow.create", { id: "research", name: "Research" }).result?.revision, 1);
    assertPatchLocatesDuplicateMain(cli(store, "workflow.patch", {
      id: "research", expectedRevision: 1, operations: failingOperations,
    }, 1));
    assert.equal(cli(store, "workflow.inspect", { id: "research" }).result?.revision, 1);
    assert.equal(cli(store, "workflow.patch", {
      id: "research", expectedRevision: 1, operations: [{ op: "addGraph", graphId: "researcher" }],
    }).ok, true);
    const stale = cli(store, "workflow.patch", {
      id: "research", expectedRevision: 1, operations: [{ op: "addGraph", graphId: "other" }],
    }, 1);
    assert.equal(stale.ok, false);
    assert.equal(stale.error?.name, "RevisionConflictError");
    assert.match(stale.error?.message ?? "", /expected 1, actual 2/);
    assert.equal(stale.error?.expectedRevision, 1);
    assert.equal(stale.error?.actualRevision, 2);
    assert.equal(cli(store, "workflow.inspect", { id: "research" }).result?.revision, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP graph patch names the failing operation and keeps the draft at revision 1", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dynamicwf-e01-mcp-"));
  const filename = join(cwd, "state.sqlite");
  const server = createMcpServer(filename, { cwd });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dynamicwf-e01", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const created = await client.callTool({
      name: "workflow_create", arguments: { id: "research", name: "Research" },
    }) as CallToolResult;
    assert.equal(created.isError ?? false, false, JSON.stringify(created.structuredContent));
    const failed = await client.callTool({
      name: "workflow_patch",
      arguments: { id: "research", expectedRevision: 1, operations: failingOperations },
    }) as CallToolResult;
    assert.equal(failed.isError, true);
    const envelope = failed.structuredContent as Envelope;
    const text = failed.content.find(item => item.type === "text");
    assert.ok(text && text.type === "text");
    assert.deepEqual(JSON.parse(text.text), envelope);
    assertPatchLocatesDuplicateMain(envelope);
    const inspected = await client.callTool({
      name: "workflow_inspect", arguments: { id: "research" },
    }) as CallToolResult;
    assert.equal(inspected.isError ?? false, false, JSON.stringify(inspected.structuredContent));
    const inspectedEnvelope = inspected.structuredContent as Envelope;
    assert.equal(inspectedEnvelope.ok, true);
    assert.equal(inspectedEnvelope.result?.revision, 1);
  } finally {
    await client.close();
    await server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
