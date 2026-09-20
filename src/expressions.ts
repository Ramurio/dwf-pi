import type { Edge, Expr, Json } from "./graph.js";

export interface ExpressionScope {
  input: Json;
  /** Completed values in this graph invocation only, never sibling scopes. */
  nodes: Readonly<Record<string, Json>>;
}

export class ExpressionError extends Error {
  override readonly name: string = "ExpressionError";
}
export class MissingReference extends ExpressionError {
  override readonly name = "MissingReference";
  constructor(readonly path: readonly string[]) {
    super(`No completed value at ${path.join(".")}`);
  }
}

function readPath(value: unknown, path: readonly string[], prefix: readonly string[] = []): Json {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) {
      throw new MissingReference([...prefix, ...path]);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (current === undefined) throw new MissingReference([...prefix, ...path]);
  return structuredClone(current) as Json;
}

function boolean(value: Json): boolean {
  if (typeof value !== "boolean") throw new ExpressionError("Condition must return a boolean");
  return value;
}

function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]!));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key]!, b[key]!));
}

/** Evaluate the data AST only. No eval, code loading, shell or model calls. */
export function evaluate(expression: Expr, scope: ExpressionScope): Json {
  const evalChild = (child: Expr) => evaluate(child, scope);
  switch (expression.op) {
    case "literal": return structuredClone(expression.value);
    case "ref": return readPath(scope, expression.path);
    case "get": return readPath(evalChild(expression.value), expression.path);
    case "select": return evalChild(boolean(evalChild(expression.when)) ? expression.then : expression.otherwise);
    case "object": return Object.fromEntries(Object.entries(expression.fields).map(([key, value]) => [key, evalChild(value)]));
    case "array": return expression.items.map(evalChild);
    case "exists":
      try { evalChild(expression.value); return true; }
      catch (error) { if (error instanceof MissingReference) return false; throw error; }
    case "not": return !boolean(evalChild(expression.value));
    case "all": return expression.items.every(item => boolean(evalChild(item)));
    case "any": return expression.items.some(item => boolean(evalChild(item)));
    case "eq": return equal(evalChild(expression.left), evalChild(expression.right));
    case "ne": return !equal(evalChild(expression.left), evalChild(expression.right));
    case "gt": case "gte": case "lt": case "lte": {
      const left = evalChild(expression.left);
      const right = evalChild(expression.right);
      if (!((typeof left === "number" && typeof right === "number") ||
            (typeof left === "string" && typeof right === "string"))) {
        throw new ExpressionError("Ordered comparison needs two numbers or two strings; coercion is disabled");
      }
      switch (expression.op) {
        case "gt": return left > right;
        case "gte": return left >= right;
        case "lt": return left < right;
        case "lte": return left <= right;
      }
    }
    default: {
      const invalid: never = expression;
      throw new ExpressionError(`Unsupported expression: ${JSON.stringify(invalid)}`);
    }
  }
}

/** Conditions take priority in authoring order; fallback applies only if none match. */
export function chooseEdge(nodeId: string, edges: readonly Edge[], scope: ExpressionScope): string {
  const result = routeEdge(nodeId, edges, scope);
  if (!result.ok) throw result.thrown;
  return result.to;
}

export interface EdgeEvaluation { edgeIndex: number; to: string; result: "true" | "false" | "not-evaluated" | "fallback" | "error" }
export interface RoutingDecision {
  version: 1; from: string; edgeIndex: number | null; to: string | null;
  reason: "condition" | "fallback" | "no-match" | "error"; evaluations: EdgeEvaluation[]; error: string | null;
}
/** Records evaluation order and short-circuiting without persisting raw input values. */
export function explainEdge(nodeId: string, edges: readonly Edge[], scope: ExpressionScope): RoutingDecision {
  return routeEdge(nodeId, edges, scope).decision;
}

type RoutingResult =
  | { ok: true; decision: RoutingDecision; to: string }
  | { ok: false; decision: RoutingDecision; thrown: unknown };

// Keep the original thrown value outside the JSON trace, including falsy values.
function routeEdge(nodeId: string, edges: readonly Edge[], scope: ExpressionScope): RoutingResult {
  const outgoing = edges.map((edge, edgeIndex) => ({ edge, edgeIndex })).filter(({ edge }) => edge.from === nodeId);
  const trace: RoutingDecision = { version: 1, from: nodeId, edgeIndex: null, to: null, reason: "no-match", error: null,
    evaluations: outgoing.map(({ edge, edgeIndex }) => ({ edgeIndex, to: edge.to, result: "not-evaluated" })) };
  const fallbacks = outgoing.filter(({ edge }) => edge.when === undefined);
  if (fallbacks.length > 1) { trace.reason = "error"; trace.error = `Multiple fallback edges from ${nodeId}`;
    return { ok: false, decision: trace, thrown: new ExpressionError(trace.error) }; }
  for (const [i, { edge, edgeIndex }] of outgoing.entries()) {
    if (edge.when === undefined) continue;
    try {
      const matched = boolean(evaluate(edge.when, scope));
      trace.evaluations[i]!.result = matched ? "true" : "false";
      if (matched) { trace.edgeIndex = edgeIndex; trace.to = edge.to; trace.reason = "condition";
        return { ok: true, decision: trace, to: edge.to }; }
    } catch (error) {
      trace.evaluations[i]!.result = "error"; trace.reason = "error";
      trace.error = error instanceof Error ? error.message : "Condition evaluation failed";
      return { ok: false, decision: trace, thrown: error };
    }
  }
  if (fallbacks[0]) {
    const { edge, edgeIndex } = fallbacks[0]; trace.edgeIndex = edgeIndex; trace.to = edge.to; trace.reason = "fallback";
    trace.evaluations.find(e => e.edgeIndex === edgeIndex)!.result = "fallback";
    return { ok: true, decision: trace, to: edge.to };
  }
  trace.error = `No matching outgoing edge from ${nodeId}`;
  return { ok: false, decision: trace, thrown: new ExpressionError(trace.error) };
}
