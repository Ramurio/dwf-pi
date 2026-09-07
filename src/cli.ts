import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CreateDraftSchema, DraftPatchSchema, DraftSchema } from "./authoring.js";
import { roleCatalog, roleNames } from "./catalog.js";
import { compileWorkflow } from "./compiler.js";
import { ExprSchema, validateWorkflow, WorkflowSchema } from "./graph.js";
import { DraftStore } from "./store.js";

function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected JSON object");
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error("Unexpected request field");
  return input as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) throw new Error("Expected a workflow or role identifier");
  return value;
}

let store: DraftStore | undefined;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    store: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: npm run --silent cli -- <tool> [--store state.sqlite] < request.json\n" +
      "Tools: catalog.list, catalog.describe, workflow.schema, workflow.create, workflow.list, workflow.inspect, workflow.patch, workflow.validate, workflow.compile\n" +
      "One JSON request on stdin; one JSON response on stdout. Runtime launch is not implemented yet.");
  } else {
    if (positionals.length !== 1) throw new Error("Specify exactly one tool; use --help");
    const tool = positionals[0]!;
    const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim();
    const request: unknown = raw ? JSON.parse(raw) : {};
    let result: unknown;
    if (tool === "catalog.list") {
      object(request, []);
      result = roleNames.map(name => ({ name, description: roleCatalog[name].description }));
    } else if (tool === "catalog.describe") {
      const input = object(request, ["name"]);
      const name = identifier(input.name);
      if (!Object.hasOwn(roleCatalog, name)) throw new Error(`Unknown role: ${name}`);
      result = roleCatalog[name as keyof typeof roleCatalog];
    } else if (tool === "workflow.schema") {
      object(request, []);
      result = { workflow: WorkflowSchema, expression: ExprSchema,
        draft: DraftSchema, create: CreateDraftSchema, patch: DraftPatchSchema };
    } else {
      const allowed = ["workflow.create", "workflow.list", "workflow.inspect", "workflow.patch", "workflow.validate", "workflow.compile"];
      if (!allowed.includes(tool)) throw new Error(`Unknown tool: ${tool}`);
      const filename = values.store ?? join(process.env.DYNAMICWF_HOME ?? join(homedir(), ".dynamicwf"), "state.sqlite");
      store = new DraftStore(filename);
      switch (tool) {
        case "workflow.create":
          result = store.create(request as Parameters<DraftStore["create"]>[0]);
          break;
        case "workflow.list":
          object(request, []); result = store.list(); break;
        case "workflow.patch": {
          const input = object(request, ["id", "expectedRevision", "operations"]);
          result = store.patch(identifier(input.id), {
            expectedRevision: input.expectedRevision, operations: input.operations,
          } as Parameters<DraftStore["patch"]>[1]);
          break;
        }
        default: {
          const input = object(request, ["id"]);
          const workflow = store.get(identifier(input.id));
          result = tool === "workflow.inspect" ? workflow
            : tool === "workflow.validate" ? validateWorkflow(workflow)
            : compileWorkflow(workflow);
          break;
        }
      }
    }
    console.log(JSON.stringify({ ok: true, result }));
  }
} catch (error) {
  const failure = error instanceof Error ? error : new Error("Unknown failure");
  console.log(JSON.stringify({ ok: false, error: {
    name: failure.name, message: failure.message,
    ...("issues" in failure ? { issues: failure.issues } : {}),
  } }));
  process.exitCode = 1;
} finally { store?.close(); }
