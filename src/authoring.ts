import { Type } from "typebox";
import { Check, Errors } from "typebox/value";
import { resolveAgentConfig } from "./catalog.js";
import { createOutputValidator } from "./output-schema.js";
import { EdgeSchema, NodeSchema, validateWorkflow, type Edge, type Expr, type Graph, type Node, type ValidationResult, type WorkflowDefinition } from "./graph.js";

export interface CreateDraftInput { id: string; name: string; entryGraph?: string }
export type AuthoringOperation =
  | { op: "addGraph"; graphId: string }
  | { op: "removeGraph"; graphId: string }
  | { op: "addNode" | "replaceNode"; graphId: string; node: Node }
  | { op: "removeNode" | "setEntry"; graphId: string; nodeId: string }
  | { op: "connect"; graphId: string; edge: Edge }
  | { op: "disconnect"; graphId: string; edgeIndex: number };
export interface DraftPatch { expectedRevision: number; operations: AuthoringOperation[] }
export type PatchRequest = DraftPatch;
export interface PatchResult { workflow: WorkflowDefinition; validation: ValidationResult }
const closed = { additionalProperties: false } as const;
const id = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]*$" });
const positiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const CreateDraftSchema = Type.Unsafe<CreateDraftInput>(Type.Object({ id, name: Type.String({ minLength: 1 }), entryGraph: Type.Optional(id) }, closed));
const operation = (op: string, fields: Record<string, import("typebox").TSchema> = {}) => Type.Object({ op: Type.Literal(op), graphId: id, ...fields }, closed);
export const AuthoringOperationSchema = Type.Unsafe<AuthoringOperation>(Type.Union([
  operation("addGraph"), operation("removeGraph"),
  operation("addNode", { node: NodeSchema }), operation("replaceNode", { node: NodeSchema }),
  operation("removeNode", { nodeId: id }), operation("setEntry", { nodeId: id }),
  operation("connect", { edge: EdgeSchema }), operation("disconnect", { edgeIndex: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }),
]));
export const DraftPatchSchema = Type.Unsafe<DraftPatch>(Type.Object({ expectedRevision: positiveInteger, operations: Type.Array(AuthoringOperationSchema, { minItems: 1 }) }, closed));
// Drafts allow empty graphs and graph-level semantic errors. Individual records
// still obey the same closed Node/Edge schema used for compilation.
export const DraftSchema = Type.Unsafe<WorkflowDefinition>(Type.Object({
  schemaVersion: Type.Literal(1), id, name: Type.String({ minLength: 1 }), revision: positiveInteger, entryGraph: id,
  graphs: Type.Record(id, Type.Object({ entry: id, nodes: Type.Array(NodeSchema), edges: Type.Array(EdgeSchema) }, closed), { minProperties: 1, additionalProperties: false }),
}, closed));

export class AuthoringError extends Error {
  constructor(message: string, readonly operationIndex?: number) { super(message); this.name = "AuthoringError"; }
}
export class RevisionConflictError extends AuthoringError {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Revision conflict: expected ${expectedRevision}, actual ${actualRevision}`); this.name = "RevisionConflictError";
  }
}

export function createDraft(input: CreateDraftInput): WorkflowDefinition {
  assertBoundary(CreateDraftSchema, input);
  const entryGraph = input.entryGraph ?? "main";
  return freeze({ schemaVersion: 1, id: input.id, name: input.name, revision: 1, entryGraph,
    graphs: { [entryGraph]: { entry: "start", nodes: [], edges: [] } },
  });
}
export function applyPatch(draft: WorkflowDefinition, patch: DraftPatch): PatchResult {
  assertBoundary(DraftSchema, draft);
  assertBoundary(DraftPatchSchema, patch);
  if (patch.expectedRevision !== draft.revision) throw new RevisionConflictError(patch.expectedRevision, draft.revision);
  if (draft.revision === Number.MAX_SAFE_INTEGER) throw new AuthoringError("Revision has reached the exact JSON integer boundary");
  if (!Object.hasOwn(draft.graphs, draft.entryGraph)) throw new AuthoringError("Draft entryGraph does not exist");
  for (const graph of Object.values(draft.graphs)) for (const node of graph.nodes) checkNodeConfig(node);
  const workflow = structuredClone(draft);
  for (const [index, operation] of patch.operations.entries()) {
    try { applyOperation(workflow, operation); }
    catch (error) { throw new AuthoringError(error instanceof Error ? error.message : String(error), index); }
  }
  workflow.revision++;
  return freeze({ workflow, validation: validateWorkflow(workflow) });
}
function applyOperation(workflow: WorkflowDefinition, operation: AuthoringOperation): void {
  if (operation.op === "addGraph") {
    if (Object.hasOwn(workflow.graphs, operation.graphId)) throw new Error(`Graph already exists: ${operation.graphId}`);
    workflow.graphs[operation.graphId] = { entry: "start", nodes: [], edges: [] };
    return;
  }
  if (!Object.hasOwn(workflow.graphs, operation.graphId)) throw new Error(`Unknown graph: ${operation.graphId}`);
  const graph = workflow.graphs[operation.graphId]!;
  switch (operation.op) {
    case "removeGraph":
      if (workflow.entryGraph === operation.graphId) throw new Error("Cannot remove the entry graph");
      delete workflow.graphs[operation.graphId]; return;
    case "addNode":
      if (graph.nodes.some((node) => node.id === operation.node.id)) throw new Error(`Node already exists: ${operation.node.id}`);
      checkNodeConfig(operation.node);
      if (graph.nodes.length === 0) graph.entry = operation.node.id;
      graph.nodes.push(structuredClone(operation.node)); return;
    case "replaceNode": {
      const index = nodeIndex(graph, operation.node.id);
      checkNodeConfig(operation.node); graph.nodes[index] = structuredClone(operation.node); return;
    }
    case "removeNode":
      graph.nodes.splice(nodeIndex(graph, operation.nodeId), 1);
      graph.edges = graph.edges.filter((edge) => edge.from !== operation.nodeId && edge.to !== operation.nodeId);
      // Keep entry unchanged: removal is explicit and a subsequent setEntry
      // operation repairs it. Adding the first node to an empty graph resets it.
      return;
    case "setEntry": nodeIndex(graph, operation.nodeId); graph.entry = operation.nodeId; return;
    case "connect":
      if (operation.edge.when) checkExpression(operation.edge.when);
      nodeIndex(graph, operation.edge.from); nodeIndex(graph, operation.edge.to);
      graph.edges.push(structuredClone(operation.edge)); return;
    case "disconnect":
      if (operation.edgeIndex >= graph.edges.length) throw new Error(`Unknown edge index: ${operation.edgeIndex}`);
      graph.edges.splice(operation.edgeIndex, 1); return;
  }
}
function nodeIndex(graph: Graph, id: string): number {
  const index = graph.nodes.findIndex((node) => node.id === id);
  if (index === -1) throw new Error(`Unknown node: ${id}`);
  return index;
}
function checkNodeConfig(node: Node): void {
  if (node.kind === "agent") resolveAgentConfig(node.role, node.config);
  switch (node.kind) {
    case "agent": checkExpression(node.task); if (node.input) checkExpression(node.input); break;
    case "transform": case "end": checkExpression(node.value); break;
    case "finish": checkExpression(node.reason); checkExpression(node.evidence); checkExpression(node.value); break;
    case "await": checkExpression(node.reason); checkExpression(node.input); createOutputValidator(node.responseSchema); break;
    case "branch": if (node.input) checkExpression(node.input); break;
    case "subworkflow": case "worktree": checkExpression(node.input); break;
    case "integrate": checkExpression(node.sources); break;
    case "map": checkExpression(node.items); break;
    case "parallel": for (const child of node.children) checkExpression(child.input); break;
    case "check": break;
    case "reuse": createOutputValidator(node.outputSchema); break;
  }
}
function checkExpression(expression: Expr): void {
  switch (expression.op) {
    case "ref":
      if (expression.path[0] !== "input" && expression.path[0] !== "nodes") throw new AuthoringError("Reference root must be input or nodes");
      if (expression.path[0] === "nodes" && expression.path.length < 2) throw new AuthoringError("Node reference must include a node ID");
      return;
    case "literal": return;
    case "object": for (const child of Object.values(expression.fields)) checkExpression(child); return;
    case "array": case "all": case "any": for (const child of expression.items) checkExpression(child); return;
    case "get": case "not": case "exists": checkExpression(expression.value); return;
    case "select": checkExpression(expression.when); checkExpression(expression.then); checkExpression(expression.otherwise); return;
    default: checkExpression(expression.left); checkExpression(expression.right);
  }
}
function assertBoundary<T>(schema: import("typebox").TUnsafe<T>, value: unknown): asserts value is T {
  assertJson(value);
  if (!Check(schema, value)) throw new AuthoringError(Errors(schema, value).map((error) => `${error.instancePath || "$"}: ${error.message}`).join("\n"));
}
function assertJson(value: unknown, path = "$", ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value !== "object") throw new AuthoringError(`${path}: expected JSON data`);
  if (ancestors.has(value)) throw new AuthoringError(`${path}: cyclic object is not JSON`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new AuthoringError(`${path}: expected plain JSON object`);
  if (Object.getOwnPropertySymbols(value).length) throw new AuthoringError(`${path}: symbol keys are not JSON`);
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new AuthoringError(`${path}: sparse or extended arrays are not JSON`);
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === "length") continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new AuthoringError(`${path}.${key}: expected enumerable data property`);
    assertJson(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
