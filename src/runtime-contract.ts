import type { Effect } from "effect";
import type { Json, Node } from "./graph.js";

/** Identity of a node activation within one run. Scope segments are never joined for identity. */
export interface RuntimeContext {
  readonly graphId: string;
  readonly nodeId: string;
  readonly scope: readonly string[];
  /** Zero-based visit number for this node in this graph invocation. */
  readonly visit: number;
}

/** Injectable execution boundary. Persistence, pause and provider policy belong to its implementation. */
export interface WorkflowRuntime {
  step(context: RuntimeContext, work: () => Effect.Effect<Json, Error>): Effect.Effect<Json, Error>;
  agent(context: RuntimeContext, node: Extract<Node, { kind: "agent" }>, task: string, input: Json): Effect.Effect<Json, Error>;
  check(context: RuntimeContext, node: Extract<Node, { kind: "check" }>): Effect.Effect<Json, Error>;
}
