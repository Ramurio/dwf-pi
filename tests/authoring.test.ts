import assert from "node:assert/strict";
import test from "node:test";
import { applyPatch, createDraft, AuthoringError, RevisionConflictError, type AuthoringOperation, type DraftPatch } from "../src/authoring.js";
import { validateWorkflow, type Node } from "../src/graph.js";

const end: Node = { id: "done", kind: "end", value: { op: "ref", path: ["input"] } };
const draft = () => createDraft({ id: "example", name: "Review loop" });

test("authoring validates await contracts and all finish expression roots before saving a patch", () => {
  const wait: Node = { id: "answer", kind: "await", reason: { op: "literal", value: "Need evidence" }, input: { op: "ref", path: ["input"] }, responseSchema: { type: "object" } };
  const finish: Node = { id: "done", kind: "finish", decision: "accepted", reason: { op: "literal", value: "Answer received" }, evidence: { op: "literal", value: [] }, value: { op: "ref", path: ["nodes", "answer"] } };
  const add = (node: Node): AuthoringOperation => ({ op: "addNode", graphId: "main", node });
  const result = applyPatch(draft(), { expectedRevision: 1, operations: [add(wait), add(finish), { op: "connect", graphId: "main", edge: { from: "answer", to: "done" } }] });
  assert.equal(result.validation.valid, true);
  for (const node of [ { ...wait, reason: { op: "ref", path: ["process"] } }, { ...finish, evidence: { op: "ref", path: ["process"] } } ] as Node[]) {
    assert.throws(() => applyPatch(draft(), { expectedRevision: 1, operations: [add(node)] }), /Reference root/);
  }
  assert.throws(() => applyPatch(draft(), { expectedRevision: 1, operations: [add({ ...wait, responseSchema: { type: "string" } })] }), /object/);
});

test("builds a review loop entirely through graph operations and reports readiness", () => {
  let workflow = draft();
  assert.equal(workflow.revision, 1);
  assert.equal(workflow.graphs.main!.entry, "start");
  assert.equal(validateWorkflow(workflow).valid, false);
  let result = applyPatch(workflow, { expectedRevision: 1, operations: [
    { op: "addNode", graphId: "main", node: { id: "implement", kind: "agent", role: "implementer", task: { op: "literal", value: "Implement the change" } } },
    { op: "addNode", graphId: "main", node: { id: "review", kind: "agent", role: "reviewer", task: { op: "literal", value: "Review" }, input: { op: "ref", path: ["nodes", "implement"] } } },
  ] });
  assert.equal(result.workflow.revision, 2);
  assert.equal(result.workflow.graphs.main!.entry, "implement");
  assert.equal(result.validation.valid, false);
  workflow = result.workflow;
  result = applyPatch(workflow, { expectedRevision: 2, operations: [
    { op: "addNode", graphId: "main", node: end },
    { op: "connect", graphId: "main", edge: { from: "implement", to: "review" } },
    { op: "connect", graphId: "main", edge: { from: "review", to: "implement", when: { op: "eq", left: { op: "ref", path: ["nodes", "review", "decision"] }, right: { op: "literal", value: "request_changes" } } } },
    { op: "connect", graphId: "main", edge: { from: "review", to: "done" } },
  ] });
  assert.equal(result.workflow.revision, 3, "revision increments once for the batch");
  assert.equal(result.validation.valid, true);
  assert.equal(workflow.graphs.main!.nodes.length, 2, "prior snapshot remains unchanged");
  assert.ok(Object.isFrozen(result.workflow.graphs.main!.nodes));
  assert.throws(() => { result.workflow.graphs.main!.edges.pop(); }, TypeError);
});

test("expectedRevision rejects stale tool calls and prevents accidental lost update", () => {
  const original = draft();
  const first = applyPatch(original, { expectedRevision: 1, operations: [{ op: "addNode", graphId: "main", node: end }] });
  assert.throws(() => applyPatch(first.workflow, { expectedRevision: 1, operations: [{ op: "removeNode", graphId: "main", nodeId: "done" }] }), RevisionConflictError);
  assert.equal(first.workflow.revision, 2);
  assert.equal(first.workflow.graphs.main!.nodes.length, 1);
});

test("failed batch rolls back all earlier operations and detaches successful operation inputs", () => {
  const original = draft();
  const before = JSON.stringify(original);
  assert.throws(() => applyPatch(original, { expectedRevision: 1, operations: [
    { op: "addNode", graphId: "main", node: end },
    { op: "setEntry", graphId: "main", nodeId: "missing" },
  ] }), (error: unknown) => error instanceof AuthoringError && error.operationIndex === 1);
  assert.equal(JSON.stringify(original), before);
  const node = structuredClone(end);
  const successful = applyPatch(original, { expectedRevision: 1, operations: [{ op: "addNode", graphId: "main", node }] });
  node.id = "mutated-after-call";
  assert.equal(successful.workflow.graphs.main!.nodes[0]!.id, "done");
});

test("future child references are draft-valid and become compile-ready once graph is built", () => {
  const one = applyPatch(draft(), { expectedRevision: 1, operations: [
    { op: "addNode", graphId: "main", node: { id: "child", kind: "subworkflow", graphId: "future", input: { op: "ref", path: ["input"] } } },
    { op: "addNode", graphId: "main", node: end },
    { op: "connect", graphId: "main", edge: { from: "child", to: "done" } },
  ] });
  assert.equal(one.validation.valid, false);
  assert.ok(one.validation.issues.some((issue) => issue.message.includes("Referenced graph")));
  const two = applyPatch(one.workflow, { expectedRevision: 2, operations: [
    { op: "addGraph", graphId: "future" }, { op: "addNode", graphId: "future", node: end },
  ] });
  assert.equal(two.validation.valid, true);
  const three = applyPatch(two.workflow, { expectedRevision: 3, operations: [{ op: "removeGraph", graphId: "future" }] });
  assert.equal(three.validation.valid, false);
  assert.equal(Object.hasOwn(three.workflow.graphs, "future"), false);
});

test("removeNode prunes only control edges and leaves explicit entry repair to author", () => {
  const initial = applyPatch(draft(), { expectedRevision: 1, operations: [
    { op: "addNode", graphId: "main", node: { id: "start", kind: "transform", value: { op: "literal", value: 1 } } },
    { op: "addNode", graphId: "main", node: end },
    { op: "connect", graphId: "main", edge: { from: "start", to: "done" } },
  ] });
  const removed = applyPatch(initial.workflow, { expectedRevision: 2, operations: [{ op: "removeNode", graphId: "main", nodeId: "start" }] });
  assert.deepEqual(removed.workflow.graphs.main!.edges, []);
  assert.equal(removed.workflow.graphs.main!.entry, "start");
  assert.equal(removed.validation.valid, false);
  const fixed = applyPatch(removed.workflow, { expectedRevision: 3, operations: [{ op: "setEntry", graphId: "main", nodeId: "done" }] });
  assert.equal(fixed.validation.valid, true);
});

test("replaceNode fully replaces config; disconnect indexes address current ordered edge array", () => {
  const initial = applyPatch(draft(), { expectedRevision: 1, operations: [
    { op: "addNode", graphId: "main", node: { id: "start", kind: "agent", role: "general", task: { op: "literal", value: "task" }, config: { thinking: "high" } } },
    { op: "addNode", graphId: "main", node: end }, { op: "connect", graphId: "main", edge: { from: "start", to: "done" } },
  ] });
  const changed = applyPatch(initial.workflow, { expectedRevision: 2, operations: [
    { op: "replaceNode", graphId: "main", node: { id: "start", kind: "transform", value: { op: "literal", value: 42 } } },
    { op: "disconnect", graphId: "main", edgeIndex: 0 },
  ] });
  assert.deepEqual(changed.workflow.graphs.main!.nodes[0], { id: "start", kind: "transform", value: { op: "literal", value: 42 } });
  assert.equal(changed.validation.valid, false);
});

const invalidOps: AuthoringOperation[] = [
  { op: "removeGraph", graphId: "main" }, { op: "removeGraph", graphId: "missing" },
  { op: "addGraph", graphId: "main" }, { op: "addNode", graphId: "missing", node: end },
  { op: "replaceNode", graphId: "main", node: end }, { op: "removeNode", graphId: "main", nodeId: "missing" },
  { op: "setEntry", graphId: "main", nodeId: "missing" }, { op: "connect", graphId: "main", edge: { from: "missing", to: "done" } },
  { op: "disconnect", graphId: "main", edgeIndex: 0 },
];
test("operations require existing graph/node/edge targets and protect entryGraph", () => {
  for (const operation of invalidOps) assert.throws(() => applyPatch(draft(), { expectedRevision: 1, operations: [operation] }), AuthoringError);
  assert.throws(() => applyPatch(draft(), { expectedRevision: 1, operations: [
    { op: "addNode", graphId: "main", node: end }, { op: "addNode", graphId: "main", node: end },
  ] }), /already exists/);
});

test("authoring boundary rejects malformed/unknown ops, nodes, expressions and effective config", () => {
  const operations: unknown[] = [
    { op: "eval", code: "process.exit()" }, { op: "addGraph", graphId: "child", extra: true },
    { op: "disconnect", graphId: "main", edgeIndex: -1 },
    { op: "addNode", graphId: "main", node: { ...end, extra: true } },
    { op: "addNode", graphId: "main", node: { ...end, value: { op: "js", source: "1+1" } } },
    { op: "addNode", graphId: "main", node: { ...end, value: { op: "ref", path: ["process", "env"] } } },
    { op: "addNode", graphId: "main", node: { ...end, value: { op: "literal", value: NaN } } },
    { op: "addNode", graphId: "main", node: { id: "a", kind: "agent", role: "reviewer", task: { op: "literal", value: "Review" }, config: { tools: ["bash"] } } },
    { op: "addNode", graphId: "main", node: { id: "a", kind: "agent", role: "oracle", task: { op: "literal", value: "Review" } } },
  ];
  for (const operation of operations) assert.throws(() => applyPatch(draft(), { expectedRevision: 1, operations: [operation] } as DraftPatch), AuthoringError);
  assert.throws(() => applyPatch(draft(), { expectedRevision: 1, operations: [] }), AuthoringError);
  assert.throws(() => createDraft({ id: "bad/id", name: "bad" }), AuthoringError);
  const getter = { op: "addGraph", graphId: "child" };
  Object.defineProperty(getter, "extra", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => applyPatch(draft(), { expectedRevision: 1, operations: [getter] } as DraftPatch), /data property/);
});
