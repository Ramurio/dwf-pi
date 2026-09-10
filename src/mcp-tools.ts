import { CreateDraftSchema, DraftPatchSchema } from "./authoring.js";
import { roleNames } from "./catalog.js";
import { serviceToolNames, type ServiceToolName } from "./service.js";

type InputSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false; $defs?: Record<string, unknown>; oneOf?: unknown[] };
const identifier = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" };
const cwd = { type: "string", minLength: 1, pattern: "^[^\\u0000]+$", description: "Workspace directory, relative to the server's cwd or absolute; defaults to server cwd." };
const model = { type: "object", properties: { provider: { type: "string", minLength: 1 }, id: { type: "string", minLength: 1 } }, required: ["provider", "id"], additionalProperties: false, description: "Actual pi provider/model ID. Sets the default for nodes without a model; explicit node choices take precedence." };
const object = (properties: Record<string, unknown> = {}, required: string[] = []): InputSchema => ({ type: "object", properties, required, additionalProperties: false });
const byId = () => object({ id: identifier }, ["id"]);
const prepare = () => object({ id: identifier, cwd, model }, ["id"]);
const preparedId = { type: "string", pattern: "^prepared-[a-f0-9]{64}$", description: "Immutable workspace-bound handle returned by workflow_prepare in this journal." };
const start: InputSchema = {
  ...object({ id: identifier, preparedId, cwd, model,
    input: { description: "JSON entry input; defaults to null." },
    idempotencyKey: { type: "string", minLength: 1, pattern: "^[^\\u0000]+$", description: "Caller-generated key unique to one intended start in this journal. Retry the same preparedId/input/key to obtain the same run; conflicts fail. Requires preparedId." },
  }),
  oneOf: [
    { required: ["preparedId"], properties: { preparedId: true, id: false, cwd: false, model: false } },
    { required: ["id"], properties: { id: true, preparedId: false, idempotencyKey: false } },
  ],
};
const scope = { type: "string", enum: ["global", "project"], description: "Library scope. Save defaults to project; reads without scope prefer project over global." };
const revision = { type: "string", pattern: "^[a-f0-9]{64}$", description: "Immutable preset revision hash; omit to use current named revision." };
const patch = JSON.parse(JSON.stringify(DraftPatchSchema)) as InputSchema;
patch.properties.id = identifier;
patch.required = ["id", ...(patch.required ?? [])];

const definitions: Record<ServiceToolName, { description: string; inputSchema: InputSchema; readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }> = {
  "run.collections": { description: "Page committed child results for a collect-policy map/parallel activation. Each item is succeeded with value or failed with a structured cause; failures are not reviewer votes. Records survive parent recovery and retain their original parent attempt. Reading does not retry work.", inputSchema: object({ id: identifier, key: { type: "string", minLength: 1 }, after: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, ["id", "key"]), readOnly: true },
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
  "workflow.prepare": { description: "Persist a frozen execution plan without inference. Returns {preparedId,planHash,cwd,createdAt,plan}; use preparedId in run_start to execute these exact settings and skill snapshots in this workspace. Resolves concrete models/thinking; explicit unavailable requests fail.", inputSchema: prepare(), openWorld: true },
  "workflow.prepared": { description: "Inspect a saved preparedId without rereading the draft, skills, workspace or provider catalog. Verifies frozen plan integrity. Handles are local to this journal.", inputSchema: object({ preparedId }, ["preparedId"]), readOnly: true },
  "run.start": { description: "Start a detached workflow by preparedId (recommended) with a stable idempotencyKey for delivery retries. Identical keyed requests return the same run, including after completion; conflicts fail. Prepared starts cannot override workspace or model. Alternatively id starts the current draft as a new, non-idempotent run. Return the run ID and watch command immediately. Workers can perform granted external effects; closing this client does not stop them.", inputSchema: start, destructive: true, openWorld: true },
  "run.status": { description: "Observe a run's status, current supervisor/worker liveness, frozen plan hash and resolved models. Reconciles verified missing processes without restarting work.", inputSchema: byId(), idempotent: true },
  "run.list": { description: "List local runs and observe their current process liveness. Does not return large frozen resource payloads.", inputSchema: object(), idempotent: true },
  "run.inspect": { description: "Inspect a run's frozen graph, input, public state and activation journal, including outputs/errors and current node visits. Internal ownership tokens are omitted.", inputSchema: byId(), idempotent: true },
  "run.events": { description: "Read durable run events after a sequence cursor. Returns events and nextAfter; pass nextAfter as after on the next call. Unknown run IDs fail.", inputSchema: object({ id: identifier, after: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "Exclusive event sequence cursor; initially 0." } }, ["id"]), idempotent: true },
  "run.usage": { description: "Read token totals and a page of per-response SDK usage records, including cached input, reasoning when reported, attempts and incomplete accounting. Reports survive worker failure/cancellation; SDK cost is not a subscription charge. nextAfter is an exclusive cursor.", inputSchema: object({ id: identifier, after: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, ["id"]), readOnly: true },
  "run.waits": { description: "Inspect durable await requests with reasons, inputs, response schemas and recorded resolutions. Waiting is distinct from operator pause. Reconciles process liveness without restarting.", inputSchema: byId(), idempotent: true },
  "run.trace": { description: "Page durable routing decisions by activation/scope/visit: selected edge, condition results, short-circuited conditions and routing failures. Identical replay does not duplicate records. Older plans explicitly report unsupported tracing; never infer historical transitions from node colors.", inputSchema: object({ id: identifier, after: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, ["id"]), readOnly: true },
  "run.resolve": { description: "Resolve a durable await using JSON matching its frozen response schema. Identical repeated responses are idempotent; conflicting responses fail. Resumes execution when operator intent is running, including relaunch after verified supervisor death. Does not undo pause or cancellation. resolvedBy is a caller-provided provenance label, not authenticated identity.", inputSchema: object({ id: identifier, waitId: identifier, response: { description: "JSON matching this wait's responseSchema." }, resolvedBy: { type: "string", minLength: 1 } }, ["id", "waitId", "response"]), idempotent: true, openWorld: true },
  "run.attempts": { description: "Inspect one activation's archived attempts and current attempt separately. key comes from run_inspect; after is an exclusive archived attempt number. Shows original errors/times/operation metadata, attempt-specific SDK accounting and missing historical records. Does not retry or reconcile execution.", inputSchema: object({ id: identifier, key: { type: "string", minLength: 1 }, after: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, ["id", "key"]), readOnly: true },
  "run.pause": { description: "Request a cooperative pause: stop admitting new activations, let active workers finish, then enter paused. Inspect status until pausing becomes paused. Use run_cancel to interrupt active work.", inputSchema: byId(), idempotent: true },
  "run.resume": { description: "Resume a paused workflow. A verified interrupted run may relaunch, but uncertain external effects are never silently repeated. Does not alter the frozen graph or undo cancellation.", inputSchema: byId(), idempotent: true, openWorld: true },
  "preset.save": { description: "Save an accepted run's exact frozen plan as an immutable tested preset. Requires technical success and an accepted task outcome; rejected, inconclusive and unclassified outcomes are refused. Credentials and prior run input/output are not the reusable definition.", inputSchema: object({ id: identifier, name: identifier, scope, cwd }, ["id", "name"]) },
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
