import type { Effect } from "effect";
import type { Json, Node, Edge } from "./graph.js";
import type { ExpressionScope } from "./expressions.js";

/** Identity of a node activation within one run. Scope segments are never joined for identity. */
export interface RuntimeContext {
  readonly graphId: string;
  readonly nodeId: string;
  readonly scope: readonly string[];
  /** Zero-based visit number for this node in this graph invocation. */
  readonly visit: number;
}

/** Вычисленные входы до внешних действий; подготовка синхронна и не выполняет I/O. */
export type OperationInputs =
  | { kind: "agent"; task: string; input: Json }
  | { kind: "integrate"; sources: Json };

/** Injectable execution boundary. Persistence, pause and provider policy belong to its implementation. */
export interface WorkflowRuntime {
  collect(context: RuntimeContext, itemId: string, work: () => Effect.Effect<Json, Error>): Effect.Effect<Json, Error>;
  route(context: RuntimeContext, edges: readonly Edge[], scope: ExpressionScope): Effect.Effect<string, Error>;
  step(context: RuntimeContext, work: () => Effect.Effect<Json, Error>): Effect.Effect<Json, Error>;
  stepOperation(context: RuntimeContext, node: Extract<Node, { kind: "agent" | "integrate" }>, prepareInputs: () => OperationInputs): Effect.Effect<Json, Error>;
  agent(context: RuntimeContext, node: Extract<Node, { kind: "agent" }>, task: string, input: Json): Effect.Effect<Json, Error>;
  worktree(context: RuntimeContext, node: Extract<Node, { kind: "worktree" }>, child: (scope: readonly string[]) => Effect.Effect<Json, Error>): Effect.Effect<Json, Error>;
  integrate(context: RuntimeContext, node: Extract<Node, { kind: "integrate" }>, sources: Json): Effect.Effect<Json, Error>;
  check(context: RuntimeContext, node: Extract<Node, { kind: "check" }>): Effect.Effect<Json, Error>;
  finish(context: RuntimeContext, node: Extract<Node, { kind: "finish" }>, reason: Json, evidence: Json, value: Json): Effect.Effect<Json, Error>;
  wait(context: RuntimeContext, node: Extract<Node, { kind: "await" }>, reason: Json, input: Json): Effect.Effect<Json, Error>;
  reuse(context: RuntimeContext, node: Extract<Node, { kind: "reuse" }>): Effect.Effect<Json, Error>;
}
