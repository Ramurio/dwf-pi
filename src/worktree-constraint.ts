import type { Json, Node } from "./graph.js";
import type { OperationRecord } from "./operation-record.js";

/** The selector is relative to the child result, never to the workspace wrapper. */
export function expectedWorktreeTree(node: Node, result: Json): string | null | undefined {
  if (node.kind !== "worktree" || node.expectedTreeFromResult === undefined) return undefined;
  let value: Json = result;
  for (const key of node.expectedTreeFromResult) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("Missing expectedTreeFromResult path");
    value = (value as Record<string, Json>)[key]!;
  }
  if (value === null) return null;
  if (typeof value !== "string" || !/^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error("Invalid expectedTreeFromResult: expected null or full git-tree OID");
  return value.slice(9);
}

/** Recovery may finish the children-phase journal gap, but never an admitted commit gap. */
export function recordedWorktreeTree(node: Node | undefined, operation: OperationRecord | undefined, phase: unknown): string | null | undefined {
  if (node?.kind !== "worktree" || node.expectedTreeFromResult === undefined) return undefined;
  if (operation?.kind !== "worktree") throw new Error("Missing worktree constraint operation");
  if (!Object.hasOwn(operation, "childResult")) {
    if (phase === "allocating" || phase === "children") return undefined;
    throw new Error("Missing worktree constraint childResult");
  }
  const expected = expectedWorktreeTree(node, operation.childResult!);
  if (!Object.hasOwn(operation, "expectedTree")) {
    if (phase === "children") return expected;
    throw new Error("Missing recorded expectedTree");
  }
  if (operation.expectedTree !== expected) throw new Error("Recorded expectedTree contradicts childResult");
  return expected;
}
