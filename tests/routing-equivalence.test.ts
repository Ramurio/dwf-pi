import assert from "node:assert/strict";
import test from "node:test";
import { chooseEdge, explainEdge, evaluate, ExpressionError, MissingReference,
  type ExpressionScope, type RoutingDecision } from "../src/expressions.js";
import type { Edge, Expr, Json } from "../src/graph.js";

// Frozen routing algorithms from 892a136465f833ad1f4b1cdc674047f7070c7514.
// Only the unchanged expression evaluator is shared with production.
function boolean(value: Json): boolean {
  if (typeof value !== "boolean") throw new ExpressionError("Condition must return a boolean");
  return value;
}
function referenceChoose(nodeId: string, edges: readonly Edge[], scope: ExpressionScope): string {
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

function referenceExplain(nodeId: string, edges: readonly Edge[], scope: ExpressionScope): RoutingDecision {
  const outgoing = edges.map((edge, edgeIndex) => ({ edge, edgeIndex })).filter(({ edge }) => edge.from === nodeId);
  const trace: RoutingDecision = { version: 1, from: nodeId, edgeIndex: null, to: null, reason: "no-match", error: null,
    evaluations: outgoing.map(({ edge, edgeIndex }) => ({ edgeIndex, to: edge.to, result: "not-evaluated" })) };
  const fallbacks = outgoing.filter(({ edge }) => edge.when === undefined);
  if (fallbacks.length > 1) { trace.reason = "error"; trace.error = `Multiple fallback edges from ${nodeId}`; return trace; }
  for (const [i, { edge, edgeIndex }] of outgoing.entries()) {
    if (edge.when === undefined) continue;
    try {
      const matched = boolean(evaluate(edge.when, scope));
      trace.evaluations[i]!.result = matched ? "true" : "false";
      if (matched) { trace.edgeIndex = edgeIndex; trace.to = edge.to; trace.reason = "condition"; return trace; }
    } catch (error) {
      trace.evaluations[i]!.result = "error"; trace.reason = "error";
      trace.error = error instanceof Error ? error.message : "Condition evaluation failed"; return trace;
    }
  }
  if (fallbacks[0]) {
    const { edge, edgeIndex } = fallbacks[0]; trace.edgeIndex = edgeIndex; trace.to = edge.to; trace.reason = "fallback";
    trace.evaluations.find(e => e.edgeIndex === edgeIndex)!.result = "fallback";
  } else trace.error = `No matching outgoing edge from ${nodeId}`;
  return trace;
}

const literal = (value: Json): Expr => ({ op: "literal", value });
const scope: ExpressionScope = { input: null, nodes: {} };
function outcome(run: () => string) {
  try { return { ok: true, value: run() }; }
  catch (error) {
    return { ok: false, constructor: error instanceof Error ? error.constructor : undefined,
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : error,
      path: error instanceof MissingReference ? error.path : undefined };
  }
}

test("781 bounded sequences independently match frozen routing, with and without unrelated edges", () => {
  const variants: (Expr | undefined)[] = [literal(true), literal(false), undefined,
    literal(1), { op: "ref", path: ["nodes", "missing"] }];
  let count = 0;
  function check(sequence: number[]) {
    count++;
    const outgoing: Edge[] = sequence.map((v, i) => {
      const when = variants[v];
      return { from: "a", to: `to-${i}`, ...(when === undefined ? {} : { when }) };
    });
    for (const interleaved of [false, true]) {
      const unrelated: Edge = { from: "other", to: "ignored", when: literal("invalid") };
      const edges = interleaved ? [unrelated, ...outgoing.flatMap(edge => [edge, unrelated])] : outgoing;
      const label = `${JSON.stringify(sequence)} interleaved=${interleaved}`;
      assert.deepEqual(outcome(() => chooseEdge("a", edges, scope)),
        outcome(() => referenceChoose("a", edges, scope)), label);
      assert.deepEqual(explainEdge("a", edges, scope), referenceExplain("a", edges, scope), label);
    }
    if (sequence.length < 4) for (let i = 0; i < variants.length; i++) check([...sequence, i]);
  }
  check([]);
  assert.equal(count, 781);
});

test("explicit full traces preserve global indexes, duplicate destinations and untouched tails", () => {
  const edges: Edge[] = [{ from: "other", to: "x" }, { from: "a", to: "same" },
    { from: "a", to: "same", when: literal(false) }, { from: "other", to: "x" },
    { from: "a", to: "same", when: literal(true) }, { from: "a", to: "same", when: literal(1) }];
  assert.equal(chooseEdge("a", edges, scope), "same");
  assert.deepEqual(explainEdge("a", edges, scope), {
    version: 1, from: "a", edgeIndex: 4, to: "same", reason: "condition", error: null,
    evaluations: [ { edgeIndex: 1, to: "same", result: "not-evaluated" },
      { edgeIndex: 2, to: "same", result: "false" }, { edgeIndex: 4, to: "same", result: "true" },
      { edgeIndex: 5, to: "same", result: "not-evaluated" } ],
  });
  assert.deepEqual(explainEdge("a", [], scope), { version: 1, from: "a", edgeIndex: null,
    to: null, reason: "no-match", error: "No matching outgoing edge from a", evaluations: [] });
  assert.throws(() => chooseEdge("a", [], scope), { constructor: ExpressionError,
    name: "ExpressionError", message: "No matching outgoing edge from a" });
  assert.deepEqual(explainEdge("a", edges.slice(0, 4), scope), {
    version: 1, from: "a", edgeIndex: 1, to: "same", reason: "fallback", error: null,
    evaluations: [{ edgeIndex: 1, to: "same", result: "fallback" }, { edgeIndex: 2, to: "same", result: "false" }],
  });
});

test("precise expression errors survive routing, including full missing paths", () => {
  const cases: [Expr, ExpressionError][] = [
    [{ op: "ref", path: ["nodes", "missing", "deep"] }, new MissingReference(["nodes", "missing", "deep"])],
    [{ op: "get", value: literal({}), path: ["missing", "deep"] }, new MissingReference(["missing", "deep"])],
    [literal("true"), new ExpressionError("Condition must return a boolean")],
    [{ op: "gt", left: literal(1), right: literal("2") },
      new ExpressionError("Ordered comparison needs two numbers or two strings; coercion is disabled")],
  ];
  for (const [when, expected] of cases) {
    const edges: Edge[] = [{ from: "a", to: "b", when }, { from: "a", to: "c", when: literal(true) }];
    assert.deepEqual(outcome(() => chooseEdge("a", edges, scope)), outcome(() => { throw expected; }));
    assert.deepEqual(explainEdge("a", edges, scope), { version: 1, from: "a", edgeIndex: null,
      to: null, reason: "error", error: expected.message, evaluations: [
        { edgeIndex: 0, to: "b", result: "error" }, { edgeIndex: 1, to: "c", result: "not-evaluated" } ] });
  }
});

test("controlled reads prove short circuit, original thrown identity and JSON-only traces", () => {
  const sentinel = new MissingReference(["original", "path"]);
  for (const thrown of [sentinel, undefined, null, false, 0, "failure"]) {
    let reads = 0;
    const controlled: ExpressionScope = { input: null, nodes: {
      get first(): Json { reads++; throw thrown; },
      get tail(): Json { reads++; return true; },
    } };
    const edges: Edge[] = ["first", "tail"].map(key => ({ from: "a", to: key, when: { op: "ref", path: ["nodes", key] } }));
    let caught = false;
    try { chooseEdge("a", edges, controlled); } catch (error) { caught = true; assert.strictEqual(error, thrown); }
    assert.equal(caught, true); assert.equal(reads, 1);
    const trace = explainEdge("a", edges, controlled);
    assert.equal(reads, 2);
    assert.deepEqual(trace, { version: 1, from: "a", edgeIndex: null, to: null, reason: "error",
      error: thrown instanceof Error ? thrown.message : "Condition evaluation failed",
      evaluations: [{ edgeIndex: 0, to: "first", result: "error" }, { edgeIndex: 1, to: "tail", result: "not-evaluated" }] });
    assert.deepEqual(JSON.parse(JSON.stringify(trace)), trace);
    for (const route of [chooseEdge, explainEdge]) {
      reads = 0;
      route("a", [{ from: "a", to: "win", when: literal(true) }, ...edges], controlled);
      assert.equal(reads, 0);
    }
    const multiple = [...edges, { from: "a", to: "fallback1" }, { from: "a", to: "fallback2" }];
    assert.throws(() => chooseEdge("a", multiple, controlled), { constructor: ExpressionError,
      name: "ExpressionError", message: "Multiple fallback edges from a" });
    assert.deepEqual(explainEdge("a", multiple, controlled), { version: 1, from: "a", edgeIndex: null,
      to: null, reason: "error", error: "Multiple fallback edges from a",
      evaluations: multiple.map((edge, edgeIndex) => ({ edgeIndex, to: edge.to, result: "not-evaluated" })) });
    assert.equal(reads, 0);
  }
});
