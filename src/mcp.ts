import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Server, type CallToolResult, type Tool } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { mcpToolDefinitions } from "./mcp-tools.js";
import { createOutputValidator } from "./output-schema.js";
import { WorkflowService, type WorkflowServiceOptions } from "./service.js";

/** Thin MCP transport adapter. All authoring, execution, persistence and control belong to WorkflowService. */
export function createMcpServer(filename?: string, options: WorkflowServiceOptions = {}): Server {
  const service = new WorkflowService(filename, options);
  const server = new Server({ name: "dynamicwf-pi", version: "0.0.0" }, {
    capabilities: { tools: {} },
    instructions: "Create workflows as graph blocks and connections through workflow_create/workflow_patch. Inspect catalog defaults and workflow_schema. Validate then run_start; loops, conditions and fan-out are generated from the graph. Runs survive this connection closing. Use run_pause to drain active work, run_resume to continue, and run_cancel to interrupt. Responses use a JSON {ok,result} or {ok:false,error} envelope in structuredContent and text.",
  });
  const entries = new Map(mcpToolDefinitions.map(definition => [definition.name, { definition, validate: createOutputValidator(definition.inputSchema) }]));
  server.setRequestHandler("tools/list", () => ({ tools: mcpToolDefinitions.map(({ serviceTool: _, ...tool }) => ({ ...tool, inputSchema: tool.inputSchema as Tool["inputSchema"] })) }));
  server.setRequestHandler("tools/call", async (request): Promise<CallToolResult> => {
    try {
      const entry = entries.get(request.params.name);
      if (!entry) throw new Error(`Unknown tool: ${request.params.name}`);
      const input = entry.validate(request.params.arguments ?? {});
      const result = await service.dispatch(entry.definition.serviceTool, input);
      // Service outputs include JSON Schema objects; serialize once for identical JSON on both surfaces.
      const envelope = JSON.parse(JSON.stringify({ ok: true, result })) as Record<string, unknown>;
      return { content: [{ type: "text", text: JSON.stringify(envelope) }], structuredContent: envelope };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Unknown tool failure");
      const envelope = { ok: false, error: { name: failure.name, message: failure.message, ...("issues" in failure ? { issues: failure.issues } : {}) } };
      const serialized = JSON.stringify(envelope);
      return { isError: true, content: [{ type: "text", text: serialized }], structuredContent: JSON.parse(serialized) };
    }
  });
  server.onclose = () => service.close();
  return server;
}

function main(): void {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    store: { type: "string" }, cwd: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    process.stderr.write("Usage: node --import tsx /absolute/path/src/mcp.ts [--store state.sqlite] [--cwd /project]\nMCP JSON-RPC over stdio. Workflow tools use underscore names; runs outlive the MCP connection.\n");
    return;
  }
  if (positionals.length) throw new Error("Unexpected positional arguments; use --help");
  const report = (error: Error) => process.stderr.write(`[dynamicwf-mcp] ${error.message}\n`);
  const handle = serveStdio(() => createMcpServer(values.store, values.cwd === undefined ? {} : { cwd: values.cwd }), { onerror: report });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void handle.close().catch(report);
  };
  process.stdin.once("end", close);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (error) {
    process.stderr.write(`[dynamicwf-mcp] ${error instanceof Error ? error.message : "Startup failed"}\n`);
    process.exitCode = 1;
  }
}
