import { CreateDraftSchema, DraftPatchSchema } from "./authoring.js";
import { roleNames } from "./catalog.js";
import { serviceToolNames, type ServiceToolName } from "./service.js";

type InputSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false; $defs?: Record<string, unknown> };
const identifier = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" };
const cwd = { type: "string", minLength: 1, pattern: "^[^\\u0000]+$", description: "Workspace directory, relative to the server's cwd or absolute; defaults to server cwd." };
const model = { type: "object", properties: { provider: { type: "string", minLength: 1 }, id: { type: "string", minLength: 1 } }, required: ["provider", "id"], additionalProperties: false, description: "Actual pi provider/model ID. Sets the default for nodes without a model; explicit node choices take precedence." };
const object = (properties: Record<string, unknown> = {}, required: string[] = []): InputSchema => ({ type: "object", properties, required, additionalProperties: false });
const byId = () => object({ id: identifier }, ["id"]);
const prepare = () => object({ id: identifier, cwd, model }, ["id"]);
const scope = { type: "string", enum: ["global", "project"], description: "Library scope. Save defaults to project; reads without scope prefer project over global." };
const revision = { type: "string", pattern: "^[a-f0-9]{64}$", description: "Immutable preset revision hash; omit to use current named revision." };
const patch = JSON.parse(JSON.stringify(DraftPatchSchema)) as InputSchema;
patch.properties.id = identifier;
patch.required = ["id", ...(patch.required ?? [])];

const definitions: Record<ServiceToolName, { description: string; inputSchema: InputSchema; readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }> = {
  "catalog.list": { description: "List available worker roles and their purposes before choosing graph blocks.", inputSchema: object(), readOnly: true },
  "catalog.models": { description: "List concrete authenticated provider/model IDs and supported thinking levels, plus actionable catalog issues. Default uses local caches; refresh:true explicitly refreshes the Grok account catalog over the network. Subscription names do not imply Heavy model access.", inputSchema: object({ refresh: { type: "boolean", description: "Explicitly refresh the authenticated Grok model catalog; defaults to false." } }), openWorld: true },
  "system.doctor": { description: "Diagnose local Node/POSIX support, workspace access, persistent state writability, Git and cached authenticated models. Does not start inference, refresh network catalogs, or modify existing database data. Reports readiness separately for pure runs, agent runs, Grok and workspace writes.", inputSchema: object({ cwd }), idempotent: true },
  "catalog.describe": { description: "Inspect a role's actual defaults: prompt, thinking, tools, permissions, session policy and output schema.", inputSchema: object({ name: { type: "string", enum: [...roleNames] } }, ["name"]), readOnly: true },
  "workflow.schema": { description: "Get complete workflow, expression, draft and patch JSON schemas. Author orchestration with blocks, bindings and edges instead of writing code.", inputSchema: object(), readOnly: true },
  "workflow.create": { description: "Create an empty persisted workflow draft. Add graphs/nodes/edges with workflow_patch; empty drafts cannot run.", inputSchema: JSON.parse(JSON.stringify(CreateDraftSchema)) as InputSchema },
  "workflow.list": { description: "List persisted workflow drafts with IDs and revisions.", inputSchema: object(), readOnly: true },
  "workflow.inspect": { description: "Inspect a draft's current blocks, bindings, edges and revision, including incomplete drafts.", inputSchema: byId(), readOnly: true },
  "workflow.patch": { description: "Atomically add/replace/remove graph blocks, set entries, connect/disconnect edges. Supply expectedRevision from the latest draft. Returns next revision and semantic validation; invalid operations fail atomically. Conditions, select expressions, loops and fan-out remain declarative data.", inputSchema: patch, destructive: true },
  "workflow.validate": { description: "Check a draft's graph structure and configuration before compilation or execution. Returns concrete validation issues.", inputSchema: byId(), readOnly: true },
  "workflow.compile": { description: "Machine-generate TypeScript + Effect from a valid draft. Returns deterministic source/hash; do not author or edit orchestration code yourself.", inputSchema: byId(), readOnly: true },
  "workflow.prepare": { description: "Prepare and inspect a frozen execution plan without launching inference: resolves available models/thinking, prompts, permissions, output schemas and complete skill snapshots. Explicit unavailable requests fail.", inputSchema: prepare(), openWorld: true },
  "run.start": { description: "Start the current draft revision as a detached local workflow. Returns a run ID; execution continues after the MCP client/harness closes. Model workers and check blocks can perform granted external effects. Missing input is null.", inputSchema: object({ id: identifier, input: { description: "JSON input bound as input inside the entry graph; defaults to null." }, cwd, model }, ["id"]), destructive: true, openWorld: true },
  "run.status": { description: "Observe a run's status, current supervisor/worker liveness, frozen plan hash and resolved models. Reconciles verified missing processes without restarting work.", inputSchema: byId(), idempotent: true },
  "run.list": { description: "List local runs and observe their current process liveness. Does not return large frozen resource payloads.", inputSchema: object(), idempotent: true },
  "run.inspect": { description: "Inspect a run's frozen graph, input, public state and activation journal, including outputs/errors and current node visits. Internal ownership tokens are omitted.", inputSchema: byId(), idempotent: true },
  "run.events": { description: "Read durable run events after a sequence cursor. Returns events and nextAfter; pass nextAfter as after on the next call. Unknown run IDs fail.", inputSchema: object({ id: identifier, after: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "Exclusive event sequence cursor; initially 0." } }, ["id"]), idempotent: true },
  "run.pause": { description: "Request a cooperative pause: stop admitting new activations, let active workers finish, then enter paused. Inspect status until pausing becomes paused. Use run_cancel to interrupt active work.", inputSchema: byId(), idempotent: true },
  "run.resume": { description: "Resume a paused workflow. A verified interrupted run may relaunch, but uncertain external effects are never silently repeated. Does not alter the frozen graph or undo cancellation.", inputSchema: byId(), idempotent: true, openWorld: true },
  "preset.save": { description: "Save a run's exact frozen execution plan as an immutable named preset in the project or global library. Credentials and prior run input/output are not the reusable definition.", inputSchema: object({ id: identifier, name: identifier, scope, cwd }, ["id", "name"]) },
  "preset.list": { description: "List workflow presets in a project/global library; without scope, project names shadow global names.", inputSchema: object({ scope, cwd }), readOnly: true },
  "preset.inspect": { description: "Inspect a named preset or immutable revision, using project-over-global lookup unless scope is explicit.", inputSchema: object({ name: identifier, scope, revision, cwd }, ["name"]), readOnly: true },
  "preset.run": { description: "Start a fresh detached run from a preset's frozen plan with new optional input. Uses snapshotted resources and models; does not rewrite the draft or reuse previous outputs.", inputSchema: object({ name: identifier, scope, revision, cwd, input: { description: "New JSON entry-graph input; defaults to null." } }, ["name"]), destructive: true, openWorld: true },
  "run.cancel": { description: "Cancel a workflow and interrupt active workers. Cancellation is separate from pause and cannot be revoked; observe cancelling until cancelled. Existing external effects are not rolled back.", inputSchema: byId(), destructive: true, idempotent: true },
};

/** TypeBox embeds named cyclic definitions more than once; publish one portable local-$ref bundle. */
export function portableInputSchema(value: InputSchema): InputSchema {
  const definitions: Record<string, unknown> = Object.create(null);
  function rewrite(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value === null || typeof value !== "object") return value;
    const schema = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    if (schema.$defs && typeof schema.$defs === "object") for (const [name, definition] of Object.entries(schema.$defs)) {
      const rewritten = rewrite(definition);
      if (Object.hasOwn(definitions, name) && JSON.stringify(definitions[name]) !== JSON.stringify(rewritten)) throw new Error(`Conflicting MCP schema definition: ${name}`);
      definitions[name] = rewritten;
    }
    for (const [key, item] of Object.entries(schema)) {
      if (key === "$defs" || key === "$id") continue;
      result[key] = key === "$ref" && typeof item === "string" && !item.startsWith("#")
        ? `#/$defs/${item.replace(/~/g, "~0").replace(/\//g, "~1")}` : rewrite(item);
    }
    return result;
  }
  const schema = rewrite(value) as InputSchema;
  if (Object.keys(definitions).length) schema.$defs = definitions;
  return schema;
}

/** Stable underscore names work with hosts that impose function-name restrictions. */
export const mcpToolDefinitions = serviceToolNames.map(serviceTool => {
  const definition = definitions[serviceTool];
  return {
    name: serviceTool.replaceAll(".", "_"), serviceTool,
    description: definition.description,
    inputSchema: portableInputSchema(definition.inputSchema),
    annotations: {
      readOnlyHint: definition.readOnly ?? false,
      destructiveHint: definition.destructive ?? false,
      idempotentHint: definition.idempotent ?? definition.readOnly ?? false,
      openWorldHint: definition.openWorld ?? false,
    },
  };
});
