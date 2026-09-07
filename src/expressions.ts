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
  const outgoing = edges.filter(edge => edge.from === nodeId);
  const fallbacks = outgoing.filter(edge => edge.when === undefined);
  if (fallbacks.length > 1) throw new ExpressionError(`Multiple fallback edges from ${nodeId}`);
  for (const edge of outgoing) {
    if (edge.when !== undefined && boolean(evaluate(edge.when, scope))) return edge.to;
  }
  const fallback = fallbacks[0];
  if (fallback) return fallback.to;
  throw new ExpressionError(`No matching outgoing edge from ${nodeId}`);
}
