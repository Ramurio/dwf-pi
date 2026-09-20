import { Type } from "typebox";
import { Check, Errors } from "typebox/value";
import { AgentConfigSchema, roleNames, resolveAgentConfig, type AgentConfig, type RoleName } from "./catalog.js";
import { createOutputValidator, defaultOutputSchema } from "./output-schema.js";
import type { TaskDecision } from "./task-outcome.js";
import { RetryPolicySchema, type RetryPolicy } from "./retry-policy.js";
import { parallelWriterIsolationIssues } from "./parallel-isolation.js";
import type { ExecutionPlan } from "./execution-types.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Expr =
  | { op: "literal"; value: Json }
  | { op: "ref"; path: string[] }
  | { op: "object"; fields: Record<string, Expr> }
  | { op: "array" | "all" | "any"; items: Expr[] }
  | { op: "get"; value: Expr; path: string[] }
  | { op: "select"; when: Expr; then: Expr; otherwise: Expr }
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; left: Expr; right: Expr }
  | { op: "not" | "exists"; value: Expr };
export type Node = { id: string } & (
  | { kind: "agent"; role: RoleName; task: Expr; input?: Expr; config?: AgentConfig; retryPolicy?: RetryPolicy }
  | { kind: "transform" | "end"; value: Expr }
  | { kind: "finish"; decision: TaskDecision; reason: Expr; evidence: Expr; value: Expr }
  | { kind: "await"; reason: Expr; input: Expr; responseSchema: Record<string, unknown> }
  | { kind: "branch"; input?: Expr }
  | { kind: "subworkflow"; graphId: string; input: Expr }
  | { kind: "worktree"; graphId: string; input: Expr; base?: string }
  | { kind: "integrate"; sources: Expr }
  | { kind: "map"; graphId: string; items: Expr; concurrency?: number; failurePolicy?: "fail-fast" | "collect" }
  | { kind: "parallel"; children: { id: string; graphId: string; input: Expr }[]; concurrency?: number; failurePolicy?: "fail-fast" | "collect" }
  | { kind: "check"; command: string; args: string[]; cwd?: string; retryPolicy?: RetryPolicy }
  | { kind: "reuse"; bindingId: string; outputSchema: Record<string, unknown> }
);
export interface Edge { from: string; to: string; when?: Expr }
export interface Graph { entry: string; nodes: Node[]; edges: Edge[] }
export interface WorkflowDefinition { schemaVersion: 1; id: string; name: string; revision: number; entryGraph: string; graphs: Record<string, Graph> }
export interface ValidationIssue { path: string; message: string }
export type ValidationResult = { valid: true; issues: [] } | { valid: false; issues: ValidationIssue[] };
const closed = { additionalProperties: false } as const;
const id = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]*$" });
const expr = Type.Ref("Expr");
const json = Type.Ref("Json");
const tagged = (op: string, fields: Record<string, import("typebox").TSchema>) => Type.Object({ op: Type.Literal(op), ...fields }, closed);
const node = (kind: string, fields: Record<string, import("typebox").TSchema>) => Type.Object({ id, kind: Type.Literal(kind), ...fields }, closed);
const positiveInt = Type.Integer({ minimum: 1 });
const definitions = {
  Json: Type.Union([Type.Null(), Type.Boolean(), Type.Number(), Type.String(), Type.Array(json), Type.Record(Type.String(), json)]),
  Expr: Type.Union([
    tagged("literal", { value: json }), tagged("ref", { path: Type.Array(Type.String(), { minItems: 1 }) }),
    tagged("object", { fields: Type.Record(Type.String(), expr) }), tagged("array", { items: Type.Array(expr) }),
    tagged("get", { value: expr, path: Type.Array(Type.String()) }),
    tagged("select", { when: expr, then: expr, otherwise: expr }),
    ...["eq", "ne", "gt", "gte", "lt", "lte"].map((op) => tagged(op, { left: expr, right: expr })),
    ...["all", "any"].map((op) => tagged(op, { items: Type.Array(expr) })),
    ...["not", "exists"].map((op) => tagged(op, { value: expr })),
  ]),
  Node: Type.Union([
    node("agent", { role: Type.Enum(roleNames), task: expr, input: Type.Optional(expr), config: Type.Optional(AgentConfigSchema), retryPolicy: Type.Optional(RetryPolicySchema) }),
    node("transform", { value: expr }), node("end", { value: expr }),
    node("finish", { decision: Type.Enum(["accepted", "rejected", "inconclusive"]), reason: expr, evidence: expr, value: expr }),
    node("await", { reason: expr, input: expr, responseSchema: Type.Record(Type.String(), Type.Unknown()) }),
    node("branch", { input: Type.Optional(expr) }),
    node("subworkflow", { graphId: id, input: expr }),
    node("worktree", { graphId: id, input: expr, base: Type.Optional(Type.String({ minLength: 1, pattern: "^[^\\u0000]+$" })) }),
    node("integrate", { sources: expr }),
    node("map", { graphId: id, items: expr, concurrency: Type.Optional(positiveInt), failurePolicy: Type.Optional(Type.Enum(["fail-fast", "collect"])) }),
    node("parallel", { children: Type.Array(Type.Object({ id, graphId: id, input: expr }, closed), { minItems: 1 }), concurrency: Type.Optional(positiveInt), failurePolicy: Type.Optional(Type.Enum(["fail-fast", "collect"])) }),
    node("check", { command: Type.String({ minLength: 1, pattern: "^[^\\u0000]+$" }), args: Type.Array(Type.String({ pattern: "^[^\\u0000]*$" })), cwd: Type.Optional(Type.String({ minLength: 1, pattern: "^[^\\u0000]+$" })), retryPolicy: Type.Optional(RetryPolicySchema) }),
    node("reuse", { bindingId: id, outputSchema: Type.Record(Type.String(), Type.Unknown()) }),
  ]),
  Graph: Type.Object({ entry: id, nodes: Type.Array(Type.Ref("Node"), { minItems: 1 }), edges: Type.Array(Type.Object({ from: id, to: id, when: Type.Optional(expr) }, closed)) }, closed),
  Workflow: Type.Object({ schemaVersion: Type.Literal(1), id, name: Type.String({ minLength: 1 }), revision: positiveInt, entryGraph: id, graphs: Type.Record(id, Type.Ref("Graph"), { minProperties: 1, additionalProperties: false }) }, closed),
};
export const WorkflowSchema = Type.Unsafe<WorkflowDefinition>(Type.Cyclic(definitions, "Workflow"));
export const NodeSchema = Type.Unsafe<Node>(Type.Cyclic({ Json: definitions.Json, Expr: definitions.Expr, Node: definitions.Node }, "Node"));
export const EdgeSchema = Type.Unsafe<Edge>(Type.Cyclic({ Json: definitions.Json, Expr: definitions.Expr, Edge: Type.Object({ from: id, to: id, when: Type.Optional(expr) }, closed) }, "Edge"));
export const ExprSchema = Type.Unsafe<Expr>(Type.Cyclic({ Json: definitions.Json, Expr: definitions.Expr }, "Expr"));

// Reject non-JSON inputs before schema walking, including cycles, sparse arrays,
// getters, undefined, NaN and unusual prototypes. This is also the API boundary
// when called directly from TypeScript instead of a JSON transport.
function jsonIssue(value: unknown, path = "$", ancestors = new Set<object>()): ValidationIssue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") return { path, message: "Expected a JSON value" };
  if (ancestors.has(value)) return { path, message: "Cyclic object is not JSON" };
  if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) return { path, message: "Expected a plain JSON array" };
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return { path, message: "Expected a plain JSON object" };
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length) return { path, message: "Symbol keys are not JSON" };
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index)))) return { path, message: "Sparse or extended array is not JSON" };
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return { path: `${path}.${key}`, message: "Only enumerable JSON data properties are allowed" };
    const issue = jsonIssue(descriptor.value, `${path}.${key}`, ancestors);
    if (issue) return issue;
  }
  ancestors.delete(value);
}
export function validateWorkflow(value: unknown, frozen?: ExecutionPlan["agents"]): ValidationResult {
  const issue = jsonIssue(value);
  if (issue) return { valid: false, issues: [issue] };
  if (!Check(WorkflowSchema, value)) return {
    valid: false,
    issues: Errors(WorkflowSchema, value).map((error) => ({ path: error.instancePath || "$", message: error.message })),
  };
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => { issues.push({ path, message }); };
  const graphIds = new Set(Object.keys(value.graphs));
  if (!graphIds.has(value.entryGraph)) add("$.entryGraph", "Entry graph does not exist");
  const dependencies = new Map<string, Set<string>>();
  for (const [graphId, graph] of Object.entries(value.graphs)) {
    const base = `$.graphs.${graphId}`;
    const nodes = new Map<string, Node>();
    const refs = new Set<string>();
    dependencies.set(graphId, refs);
    for (const [i, item] of graph.nodes.entries()) {
      if (nodes.has(item.id)) add(`${base}.nodes[${i}].id`, `Duplicate node ID: ${item.id}`);
      nodes.set(item.id, item);
    }
    if (!nodes.has(graph.entry)) add(`${base}.entry`, "Entry node does not exist");
    for (const [i, item] of graph.nodes.entries()) {
      const path = `${base}.nodes[${i}]`;
      if ((item.kind === "agent" || item.kind === "check") && item.retryPolicy?.provider && !item.retryPolicy.codes.includes("provider")) add(`${path}.retryPolicy.provider`, "Provider retry options require the provider failure code");
      if (item.kind === "subworkflow" || item.kind === "map" || item.kind === "worktree") refs.add(item.graphId);
      if (item.kind === "parallel") {
        const childIds = new Set<string>();
        for (const [j, child] of item.children.entries()) {
          refs.add(child.graphId);
          if (childIds.has(child.id)) add(`${path}.children[${j}].id`, `Duplicate child ID: ${child.id}`);
          childIds.add(child.id);
        }
      }
      for (const expression of expressions(item)) inspectExpr(expression, nodes, path, add);
      if (item.kind === "agent") {
        try {
          const config = resolveAgentConfig(item.role, item.config);
          try { createOutputValidator(structuredClone(config.outputSchema ?? defaultOutputSchema)); }
          catch (error) { add(`${path}.config.outputSchema`, error instanceof Error ? error.message : "Invalid output schema"); }
        } catch (error) { add(`${path}.config`, error instanceof Error ? error.message : "Invalid effective agent configuration"); }
      }
      if (item.kind === "await") {
        try { createOutputValidator(item.responseSchema); }
        catch (error) { add(`${path}.responseSchema`, error instanceof Error ? error.message : "Invalid response schema"); }
      }
      if (item.kind === "reuse") {
        try { createOutputValidator(item.outputSchema); }
        catch (error) { add(`${path}.outputSchema`, error instanceof Error ? error.message : "Invalid reuse output schema"); }
      }
    }
    for (const target of refs) if (!graphIds.has(target)) add(base, `Referenced graph does not exist: ${target}`);
    const next = new Map<string, Set<string>>();
    const previous = new Map<string, Set<string>>();
    const fallbacks = new Set<string>();
    const edgeKeys = new Set<string>();
    for (const [i, edge] of graph.edges.entries()) {
      const path = `${base}.edges[${i}]`;
      if (!nodes.has(edge.from)) add(`${path}.from`, `Unknown node: ${edge.from}`);
      if (!nodes.has(edge.to)) add(`${path}.to`, `Unknown node: ${edge.to}`);
      if (["end", "finish"].includes(nodes.get(edge.from)?.kind ?? "")) add(path, "End node cannot have outgoing edges");
      const key = JSON.stringify(edge);
      if (edgeKeys.has(key)) add(path, "Duplicate edge");
      edgeKeys.add(key);
      if (!edge.when) {
        if (fallbacks.has(edge.from)) add(path, `Multiple unconditional fallback edges from ${edge.from}`);
        fallbacks.add(edge.from);
      } else inspectExpr(edge.when, nodes, `${path}.when`, add);
      const targets = next.get(edge.from) ?? new Set<string>(); targets.add(edge.to); next.set(edge.from, targets);
      const sources = previous.get(edge.to) ?? new Set<string>(); sources.add(edge.from); previous.set(edge.to, sources);
    }
    const reachable = walk([graph.entry], next);
    const canEnd = walk(graph.nodes.filter((item) => item.kind === "end" || item.kind === "finish").map((item) => item.id), previous);
    for (const item of graph.nodes) {
      if (!reachable.has(item.id)) add(base, `Unreachable node: ${item.id}`);
      if (!canEnd.has(item.id)) add(base, `Node has no structural path to an end: ${item.id}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(graphId: string, trail: string[]) {
    if (visiting.has(graphId)) { add("$.graphs", `Recursive graph reference: ${[...trail, graphId].join(" -> ")}`); return; }
    if (visited.has(graphId)) return;
    visiting.add(graphId);
    for (const target of dependencies.get(graphId) ?? []) visit(target, [...trail, graphId]);
    visiting.delete(graphId); visited.add(graphId);
  }
  for (const graphId of graphIds) visit(graphId, []);
  const reachableGraphs = walk([value.entryGraph], dependencies);
  for (const graphId of graphIds) if (!reachableGraphs.has(graphId)) add(`$.graphs.${graphId}`, "Graph is not referenced from entryGraph");
  const bindingIds = new Set<string>();
  for (const [graphId, graph] of Object.entries(value.graphs)) {
    for (const [i, item] of graph.nodes.entries()) {
      if (item.kind !== "reuse") continue;
      if (bindingIds.has(item.bindingId)) add(`$.graphs.${graphId}.nodes[${i}].bindingId`, `Duplicate reuse binding: ${item.bindingId}`);
      bindingIds.add(item.bindingId);
    }
  }
  // Изоляцию можно проверять только после проверки ссылок, циклов и конфигураций.
  if (!issues.length) issues.push(...parallelWriterIsolationIssues(value, frozen));
  return issues.length ? { valid: false, issues } : { valid: true, issues: [] };
}
function walk(starts: string[], adjacency: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>(); const pending = [...starts];
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return seen;
}
function expressions(node: Node): Expr[] {
  switch (node.kind) {
    case "agent": return node.input ? [node.task, node.input] : [node.task];
    case "transform": case "end": return [node.value];
    case "finish": return [node.value, node.reason, node.evidence];
    case "await": return [node.reason, node.input];
    case "branch": return node.input ? [node.input] : [];
    case "subworkflow": case "worktree": return [node.input];
    case "integrate": return [node.sources];
    case "map": return [node.items];
    case "parallel": return node.children.map((child) => child.input);
    case "check": return [];
    case "reuse": return [];
  }
}
function inspectExpr(expr: Expr, nodes: Map<string, Node>, path: string, add: (path: string, message: string) => void): void {
  switch (expr.op) {
    case "ref":
      if (expr.path[0] !== "input" && expr.path[0] !== "nodes") add(path, "Reference root must be input or nodes");
      if (expr.path[0] === "nodes" && (expr.path.length < 2 || !nodes.has(expr.path[1]!))) add(path, "Node reference must name a node in the current graph");
      return;
    case "literal": return;
    case "object": for (const child of Object.values(expr.fields)) inspectExpr(child, nodes, path, add); return;
    case "array": case "all": case "any": for (const child of expr.items) inspectExpr(child, nodes, path, add); return;
    case "get": case "not": case "exists": inspectExpr(expr.value, nodes, path, add); return;
    case "select": for (const child of [expr.when, expr.then, expr.otherwise]) inspectExpr(child, nodes, path, add); return;
    default: inspectExpr(expr.left, nodes, path, add); inspectExpr(expr.right, nodes, path, add);
  }
}
export class WorkflowValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "WorkflowValidationError";
  }
}
export function parseWorkflow(value: unknown, frozen?: ExecutionPlan["agents"]): WorkflowDefinition {
  const result = validateWorkflow(value, frozen);
  if (!result.valid) throw new WorkflowValidationError(result.issues);
  return freeze(structuredClone(value as WorkflowDefinition));
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
