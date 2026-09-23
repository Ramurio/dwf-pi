import assert from "node:assert/strict";
import { Effect } from "effect";
import type { Json, Node } from "../../src/graph.js";
import type { RuntimeContext } from "../../src/runtime-contract.js";
import type { JournalRuntime } from "../../src/run-runtime.js";
import { activationKey } from "../../src/run-store.js";
import type { OperationRecord } from "../../src/operation-record.js";

type AgentOperation = Extract<OperationRecord, { kind: "agent" }>;
type AgentNode = Extract<Node, { kind: "agent" }>;

/** Заменяет только исполнителя после допуска; подготовка и запись operation остаются настоящими. */
export function replaceAgentExecution(runtime: JournalRuntime, handler: (context: RuntimeContext, node: AgentNode, operation: AgentOperation) => Effect.Effect<Json, Error>): void {
  const boundary = runtime as unknown as {
    executeAgent(context: RuntimeContext, node: AgentNode, operation: () => AgentOperation): Effect.Effect<Json, Error>;
  };
  boundary.executeAgent = (context, node, prepare) => Effect.try({
    try: () => {
      const operation = prepare();
      assert.deepEqual(runtime.store.getActivation(runtime.run.id, activationKey(context))!.metadata.operation, operation);
      return operation;
    },
    catch: error => error instanceof Error ? error : new Error(String(error)),
  }).pipe(Effect.flatMap(operation => handler(context, node, operation)));
}
