import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import { Type } from "typebox";
import { AgentConfigSchema, resolveAgentConfig, roleCatalog, roleNames } from "../src/catalog.js";
import { parseWorkflow, validateWorkflow, WorkflowValidationError, type WorkflowDefinition, type Expr } from "../src/graph.js";

const literal = (value: string | boolean | number | null): Expr => ({ op: "literal", value });
const base = (): WorkflowDefinition => ({
  schemaVersion: 1, id: "example", name: "Implement and review", revision: 1, entryGraph: "main",
  graphs: { main: {
    entry: "implement", nodes: [
      { id: "implement", kind: "agent", role: "implementer", task: literal("Fix the reported defect") },
      { id: "review", kind: "agent", role: "reviewer", task: literal("Review the change"), input: { op: "ref", path: ["nodes", "implement"] } },
      { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "review"] } },
    ], edges: [
      { from: "implement", to: "review" },
      { from: "review", to: "implement", when: { op: "eq", left: { op: "ref", path: ["nodes", "review", "decision"] }, right: literal("request_changes") } },
      { from: "review", to: "done" },
    ],
  } },
});
function rejected(value: unknown, match?: RegExp) {
  const result = validateWorkflow(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.length);
  if (match) assert.match(result.issues.map((issue) => issue.message).join("\n"), match);
  assert.throws(() => parseWorkflow(value), WorkflowValidationError);
}

test("accepts repair loops; snapshots detach and recursively freeze input", () => {
  const source = base();
  assert.deepEqual(validateWorkflow(source), { valid: true, issues: [] });
  const snapshot = parseWorkflow(source);
  source.name = "edited draft";
  source.graphs.main!.nodes[0]!.id = "changed";
  assert.equal(snapshot.name, "Implement and review");
  assert.equal(snapshot.graphs.main!.nodes[0]!.id, "implement");
  assert.throws(() => { snapshot.graphs.main!.edges.push({ from: "done", to: "review" }); }, TypeError);
});

test("accepts nested map, parallel, check, branch and expression composition", () => {
  const workflow = base();
  workflow.graphs.main = { entry: "mapped", nodes: [
    { id: "mapped", kind: "map", graphId: "child", items: { op: "ref", path: ["input", "items"] } },
    { id: "parallel", kind: "parallel", concurrency: 2, children: [
      { id: "left", graphId: "child", input: { op: "ref", path: ["nodes", "mapped"] } },
      { id: "right", graphId: "child", input: literal("other") },
    ] },
    { id: "call", kind: "subworkflow", graphId: "child", input: { op: "object", fields: { first: { op: "get", value: { op: "ref", path: ["nodes", "parallel"] }, path: ["left"] } } } },
    { id: "check", kind: "check", command: "node", args: ["--version"] },
    { id: "branch", kind: "branch", input: { op: "ref", path: ["nodes", "check"] } },
    { id: "done", kind: "end", value: { op: "array", items: [{ op: "ref", path: ["nodes", "call"] }] } },
  ], edges: [
    { from: "mapped", to: "parallel" }, { from: "parallel", to: "call" }, { from: "call", to: "check" }, { from: "check", to: "branch" },
    { from: "branch", to: "done", when: { op: "all", items: [{ op: "exists", value: { op: "ref", path: ["input", "optional"] } }, { op: "not", value: literal(false) }] } },
  ] };
  workflow.graphs.child = { entry: "end", nodes: [{ id: "end", kind: "end", value: { op: "ref", path: ["input"] } }], edges: [] };
  assert.equal(validateWorkflow(workflow).valid, true);
});

const mutations: [string, (workflow: WorkflowDefinition) => void, RegExp?][] = [
  ["duplicate node IDs", (w) => { w.graphs.main!.nodes.push(w.graphs.main!.nodes[0]!); }, /Duplicate node/],
  ["dangling edge target", (w) => { w.graphs.main!.edges[0]!.to = "missing"; }, /Unknown node/],
  ["missing entry", (w) => { w.graphs.main!.entry = "missing"; }, /Entry node/],
  ["missing entry graph", (w) => { w.entryGraph = "missing"; }, /Entry graph/],
  ["multiple fallback edges", (w) => { w.graphs.main!.edges.push({ from: "review", to: "review" }); }, /Multiple unconditional/],
  ["duplicate edges", (w) => { w.graphs.main!.edges.push({ ...w.graphs.main!.edges[0]! }); }, /Duplicate edge/],
  ["unreachable node", (w) => { w.graphs.main!.nodes.push({ id: "orphan", kind: "end", value: literal(null) }); }, /Unreachable node/],
  ["loop without end path", (w) => { w.graphs.main!.edges.pop(); }, /no structural path/],
  ["outgoing edge from end", (w) => { w.graphs.main!.edges.push({ from: "done", to: "review" }); }, /End node/],
  ["missing child graph", (w) => { w.graphs.main!.nodes[0] = { id: "implement", kind: "subworkflow", graphId: "missing", input: literal(null) }; }, /Referenced graph/],
  ["recursive child graph", (w) => { w.graphs.main!.nodes[0] = { id: "implement", kind: "map", graphId: "main", items: { op: "array", items: [] } }; }, /Recursive graph/],
  ["unknown ref root", (w) => { w.graphs.main!.nodes[2] = { id: "done", kind: "end", value: { op: "ref", path: ["process", "env"] } }; }, /Reference root/],
  ["unknown local node reference", (w) => { w.graphs.main!.nodes[2] = { id: "done", kind: "end", value: { op: "ref", path: ["nodes", "missing"] } }; }, /Node reference/],
  ["duplicate parallel child IDs", (w) => { w.graphs.main!.nodes[0] = { id: "implement", kind: "parallel", children: [{ id: "a", graphId: "main", input: literal(null) }, { id: "a", graphId: "main", input: literal(null) }] }; }, /Duplicate child ID/],
];
for (const [name, mutate, match] of mutations) test(`rejects ${name}`, () => { const workflow = base(); mutate(workflow); rejected(workflow, match); });

test("rejects mutual graph recursion even when each local control flow ends", () => {
  const workflow = base();
  workflow.graphs.main!.nodes[0] = { id: "implement", kind: "subworkflow", graphId: "child", input: literal(null) };
  workflow.graphs.child = { entry: "call", nodes: [
    { id: "call", kind: "subworkflow", graphId: "main", input: literal(null) }, { id: "end", kind: "end", value: literal(null) },
  ], edges: [{ from: "call", to: "end" }] };
  rejected(workflow, /main -> child -> main/);
});

test("strict transport rejects unknown properties, executable expressions and malformed config", () => {
  const cases: unknown[] = [
    { ...base(), surprise: true }, { ...base(), revision: 0 },
    ...[
      { role: "oracle" }, { role: "reviewer", config: { model: { provider: "x", id: "m", apiKey: "secret" } } },
      { role: "reviewer", config: { tools: ["web"] } }, { role: "reviewer", config: { permission: "sudo" } },
      { role: "reviewer", config: { thinking: "ultra" } }, { role: "reviewer", config: { timeout: 2 } },
      { role: "reviewer", config: { outputSchema: false } }, { role: "reviewer", task: { op: "js", code: "process.exit()" } },
    ].map((props) => { const w = base(); w.graphs.main!.nodes[0] = { id: "implement", kind: "agent", task: literal("task"), ...props } as never; return w; }),
  ];
  for (const value of cases) rejected(value);
});

test("rejects non-JSON values without executing getters", () => {
  for (const value of [undefined, NaN, Infinity, 1n, () => null, new Date(), [,]]) {
    const w = base(); w.graphs.main!.nodes[2] = { id: "done", kind: "end", value: { op: "literal", value } } as never;
    rejected(w);
  }
  const w = base();
  Object.defineProperty(w, "surprise", { enumerable: true, get() { throw new Error("must not run"); } });
  rejected(w, /data properties/);
  const cyclic = base() as unknown as Record<string, unknown>; cyclic.self = cyclic;
  rejected(cyclic, /Cyclic/);
});

test("catalog defaults have valid schemas, independent fresh review, no invented models or caps", () => {
  for (const name of roleNames) {
    const defaults = resolveAgentConfig(name);
    assert.equal(Check(AgentConfigSchema, defaults), true, name);
    assert.ok(defaults.systemPrompt?.includes("worker"));
    assert.equal(defaults.model, undefined);
    assert.equal(Object.hasOwn(defaults, "maxIterations"), false);
    assert.ok(Object.isFrozen(defaults));
  }
  assert.equal(roleCatalog.implementer.defaults.session, "continue-node");
  assert.equal(roleCatalog.reviewer.defaults.session, "fresh");
  assert.equal(roleCatalog.reviewer.defaults.permission, "read-only");
  const schema = Type.Unsafe(roleCatalog.reviewer.defaults.outputSchema!);
  assert.equal(Check(schema, { decision: "approve", artifactRevision: "git:abc123", summary: "Verified", findings: [] }), true);
  assert.equal(Check(schema, { decision: "maybe", summary: "Uncertain", findings: [] }), false);
  assert.equal(Check(schema, { decision: "request_changes", artifactRevision: "git:abc123", summary: "Bug", findings: [{ severity: "error", message: "Missing guard" }] }), true);
  assert.equal(Check(schema, { decision: "approve", findings: [] }), false);
});

test("validates effective permissions, concurrency and argv boundaries", () => {
  for (const config of [{ permission: "read-only" }, { permission: "read-only", tools: ["bash"] }] as const) {
    const w = base();
    w.graphs.main!.nodes[0] = { id: "implement", kind: "agent", role: "implementer", task: literal("task"), config: structuredClone(config) } as never;
    rejected(w, /read-only/);
  }
  for (const replacement of [
    { kind: "map", graphId: "main", items: { op: "array", items: [] }, concurrency: 0 },
    { kind: "map", graphId: "main", items: { op: "array", items: [] }, concurrency: 1.5 },
    { kind: "check", command: "node", args: ["\u0000"] },
    { kind: "check", command: "node --version", args: [], shell: true },
  ]) {
    const w = base(); w.graphs.main!.nodes[0] = { id: "implement", ...replacement } as never; rejected(w);
  }
  const w = base(); w.graphs.main!.nodes[0] = { id: "implement", kind: "agent", role: "implementer", task: literal("task"), config: { permission: "read-only", tools: ["read"] } };
  assert.equal(validateWorkflow(w).valid, true);
});


test("review verdict binds to artifact revision and supports honest inconclusive results", () => {
  const schema = Type.Unsafe(roleCatalog.reviewer.defaults.outputSchema!);
  assert.equal(Check(schema, { decision: "approve", summary: "Looks fine", findings: [] }), false);
  assert.equal(Check(schema, { decision: "inconclusive", artifactRevision: "sha256:abc", acceptanceCriteriaRevision: "criteria:2", summary: "Integration evidence unavailable", findings: [] }), true);
  assert.equal(Check(schema, { decision: "approve", artifactRevision: "", summary: "Looks fine", findings: [] }), false);
  assert.throws(() => resolveAgentConfig("reviewer", { tools: ["bash"] }), /read-only/);
  assert.equal(resolveAgentConfig("reviewer", { thinking: "max" }).thinking, "max");
  const workflow = base();
  workflow.graphs.main!.nodes[0] = { id: "implement", kind: "agent", role: "reviewer", task: literal("review"), config: { tools: ["bash"] } };
  rejected(workflow, /read-only/);
});

test("graph rejects exotic array prototypes before getters or overridden iteration", () => {
  let calls = 0;
  const sparse = Object.assign(new Array(1), { extra: 42 });
  const proto = Object.create(Array.prototype);
  Object.defineProperty(proto, "0", { get() { calls++; return 7; } });
  Object.setPrototypeOf(sparse, proto);
  const w = base();
  w.graphs.main!.nodes[2] = { id: "done", kind: "end", value: { op: "literal", value: sparse } };
  rejected(w, /plain JSON array/);
  class Exotic extends Array { override entries(): any { calls++; return super.entries(); } }
  w.graphs.main!.nodes = Exotic.from(base().graphs.main!.nodes) as any;
  rejected(w, /plain JSON array/);
  assert.equal(calls, 0);
});

test("worktree selector is an optional array of strings, including the root path", () => {
  for (const selector of [[], ["nested", "approved"], "approved", [1], null]) {
    const flow = base();
    flow.graphs.child = { entry: "done", nodes: [{ id: "done", kind: "end", value: literal(null) }], edges: [] };
    flow.graphs.main = { entry: "candidate", nodes: [{ id: "candidate", kind: "worktree", graphId: "child", input: literal(null), expectedTreeFromResult: selector } as any, { id: "done", kind: "end", value: literal(null) }], edges: [{ from: "candidate", to: "done" }] };
    assert.equal(validateWorkflow(flow).valid, Array.isArray(selector) && selector.every(v => typeof v === "string"));
  }
});
