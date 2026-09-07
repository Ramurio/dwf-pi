import assert from "node:assert/strict";
import test from "node:test";
import { chooseEdge, evaluate, ExpressionError, MissingReference } from "../src/expressions.js";
import type { Expr } from "../src/graph.js";

const literal = (value: import("../src/graph.js").Json): Expr => ({ op: "literal", value });
const ref = (...path: string[]): Expr => ({ op: "ref", path });
const scope = { input: { question: "review", nested: [3, 7] }, nodes: { review: { decision: "request_changes" } } };

test("bindings assemble independent JSON values from explicit inputs and completed outputs", () => {
  const output = evaluate({ op: "object", fields: {
    input: ref("input"), finding: ref("nodes", "review", "decision"),
    item: { op: "get", value: ref("input", "nested"), path: ["1"] },
  } }, scope) as Record<string, unknown>;
  assert.deepEqual(output, { input: scope.input, finding: "request_changes", item: 7 });
  (output.input as { question: string }).question = "changed";
  assert.equal(scope.input.question, "review", "outputs cannot mutate the stored input");
});

test("missing output is an error, while exists supports guarded first loop visits", () => {
  assert.throws(() => evaluate(ref("nodes", "unvisited"), scope), MissingReference);
  assert.equal(evaluate({ op: "exists", value: ref("nodes", "unvisited") }, scope), false);
  assert.equal(evaluate({ op: "exists", value: literal(null) }, scope), true);
  assert.equal(evaluate({ op: "all", items: [
    { op: "exists", value: ref("nodes", "unvisited") },
    { op: "eq", left: ref("nodes", "unvisited"), right: literal(1) },
  ] }, scope), false, "guard must short circuit before reading the missing value");
  assert.throws(() => evaluate({ op: "exists", value: { op: "not", value: literal(1) } }, scope), ExpressionError);
});

test("conditions reject coercion; JSON equality ignores object insertion order", () => {
  assert.equal(evaluate({ op: "eq", left: literal({ a: 1, b: [2] }), right: literal({ b: [2], a: 1 }) }, scope), true);
  assert.equal(evaluate({ op: "eq", left: literal("1"), right: literal(1) }, scope), false);
  assert.throws(() => evaluate({ op: "gt", left: literal("2"), right: literal(1) }, scope), /coercion/);
  assert.throws(() => evaluate({ op: "not", value: literal("false") }, scope), /boolean/);
});

test("inherited properties cannot be read; literal strings are never executed", () => {
  assert.throws(() => evaluate(ref("input", "constructor"), scope), MissingReference);
  assert.throws(() => evaluate(ref("nodes", "__proto__"), scope), MissingReference);
  const text = "process.exit(99); $(touch /tmp/should-never-run)";
  assert.equal(evaluate(literal(text), scope), text);
  const object = evaluate({ op: "object", fields: JSON.parse('{"__proto__":{"op":"literal","value":{"polluted":true}}}') }, scope);
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  assert.equal(Object.hasOwn(object as object, "__proto__"), true);
  assert.equal(Object.hasOwn({}, "polluted"), false);
});

test("review rejection follows the back edge; first true condition beats fallback anywhere", () => {
  const edges = [
    { from: "review", to: "finish" },
    { from: "review", to: "implement", when: { op: "eq", left: ref("nodes", "review", "decision"), right: literal("request_changes") } as Expr },
    { from: "review", to: "other", when: literal(true) },
  ];
  assert.equal(chooseEdge("review", edges, scope), "implement");
  assert.equal(chooseEdge("review", edges.slice(0, 2), { input: {}, nodes: { review: { decision: "approve" } } }), "finish");
  assert.throws(() => chooseEdge("review", [{ from: "review", to: "finish", when: literal(false) }], scope), /No matching/);
  assert.throws(() => chooseEdge("review", [{ from: "review", to: "finish", when: literal("approve") }], scope), /boolean/);
  assert.throws(() => chooseEdge("review", [{ from: "review", to: "a" }, { from: "review", to: "b" }], scope), /Multiple fallback/);
});
