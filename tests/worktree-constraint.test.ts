import test from "node:test";
import assert from "node:assert/strict";
import { expectedWorktreeTree, recordedWorktreeTree } from "../src/worktree-constraint.js";
import type { Node, Json } from "../src/graph.js";
const node: Node = { id: "candidate", kind: "worktree", graphId: "child", input: { op: "literal", value: null }, expectedTreeFromResult: ["approved"] };
test("tree selectors are exact and own; null is explicit and root selector supported", () => {
  for (const length of [40, 64]) {
    const oid = "a".repeat(length);
    assert.equal(expectedWorktreeTree(node, { approved: `git-tree:${oid}` }), oid);
    assert.equal(expectedWorktreeTree({ ...node, expectedTreeFromResult: [] }, `git-tree:${oid}`), oid);
  }
  assert.equal(expectedWorktreeTree(node, { approved: null }), null);
  for (const value of [{}, null, { approved: 12 }, { approved: "" }, { approved: "git-tree:abc" }, { approved: `git-tree:${"a".repeat(40)}\n` }]) assert.throws(() => expectedWorktreeTree(node, value as Json));
  assert.throws(() => expectedWorktreeTree({ ...node, expectedTreeFromResult: ["approved", "nested"] }, { approved: null }));
  assert.equal(expectedWorktreeTree({ ...node, expectedTreeFromResult: undefined } as unknown as Node, {}), undefined);
});
test("recorded obligation cannot be omitted or contradicted after admission", () => {
  const operation = { kind: "worktree" as const, source: "/repo", childScope: [], childResult: { approved: `git-tree:${"a".repeat(40)}` } };
  assert.equal(recordedWorktreeTree(node, operation, "children"), "a".repeat(40));
  assert.throws(() => recordedWorktreeTree(node, operation, "committing"));
  assert.throws(() => recordedWorktreeTree(node, { ...operation, expectedTree: null }, "children"));
  assert.equal(recordedWorktreeTree(node, { ...operation, expectedTree: "a".repeat(40) }, "complete"), "a".repeat(40));
});
