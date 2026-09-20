import assert from "node:assert/strict";
import test from "node:test";
import { applyPatch, AuthoringError, createDraft, type DraftPatch } from "../src/authoring.js";
import { createOutputValidator, defaultOutputSchema } from "../src/output-schema.js";

const validate = createOutputValidator({ ...defaultOutputSchema });
const draft = () => createDraft({ id: "arrays", name: "JSON arrays" });
function patch(value: unknown, preceding = false): DraftPatch {
  return { expectedRevision: 1, operations: [
    ...(preceding ? [{ op: "addGraph", graphId: "child" }] : []),
    { op: "addNode", graphId: "main", node: { id: "done", kind: "end", value: { op: "literal", value } } },
  ] } as DraftPatch;
}
function rejectAuthoring(value: unknown, message: RegExp) {
  const original = draft();
  const before = structuredClone(original);
  assert.throws(() => applyPatch(original, patch(value, true)), (error: unknown) =>
    error instanceof AuthoringError && error.operationIndex === undefined && message.test(error.message));
  assert.deepEqual(original, before);
  assert.equal(original.revision, 1);
}
function compensated(key: string, partial = false): unknown[] {
  const array = new Array(partial ? 2 : 1);
  if (partial) array[0] = null;
  Object.assign(array, { [key]: null });
  assert.equal(Object.keys(array).length, array.length);
  assert.equal(Object.hasOwn(array, partial ? "1" : "0"), false);
  return array;
}
for (const key of ["extra", "01", "-1", "4294967295"]) {
  for (const shape of ["empty", "partial", "nested"]) {
    const make = () => {
      const array = compensated(key, shape === "partial");
      return shape === "nested" ? { nested: [array] } : array;
    };
    test(`output rejects compensated hole: ${key}/${shape}`, () => {
      assert.throws(() => validate({ result: make() }), /sparse or extended array/);
    });
    test(`authoring rejects compensated hole atomically: ${key}/${shape}`, () => {
      rejectAuthoring(make(), /sparse or extended arrays/);
    });
  }
}
test("output schema JSON data rejects compensated holes", () => {
  assert.throws(() => createOutputValidator({ ...defaultOutputSchema, examples: [{ result: compensated("extra") }] }), /sparse or extended array/);
});

const shared = { nested: [1, null] };
const accepted: [string, unknown][] = [
  ["empty", []], ["nested dense", [[], [null, true, "", 1.5], { values: [false] }]],
  ["null", null], ["true", true], ["false", false], ["string", "text"], ["empty string", ""],
  ["zero", 0], ["negative zero", -0], ["finite", Number.MAX_VALUE], ["fraction", -1.25],
  ["plain", { data: 1 }], ["null prototype", Object.assign(Object.create(null), { data: [1] })],
  ["frozen", Object.freeze([Object.freeze([1])])], ["shared noncyclic", [shared, shared]],
];
function frozenDetached(actual: unknown, source: unknown) {
  if (source !== null && typeof source === "object") {
    assert.notEqual(actual, source);
    assert.ok(Object.isFrozen(actual));
    for (const key of Object.keys(source)) frozenDetached((actual as Record<string, unknown>)[key], (source as Record<string, unknown>)[key]);
  }
}
for (const [name, value] of accepted) {
  test(`both boundaries accept ${name}; authoring freezes detached snapshot`, () => {
    const expected = structuredClone(value);
    assert.deepEqual(validate({ result: value }), { result: expected });
    const original = draft();
    const result = applyPatch(original, patch(value));
    assert.equal(result.workflow.revision, original.revision + 1);
    assert.equal(result.validation.valid, true);
    const node = result.workflow.graphs.main!.nodes[0]!;
    assert.ok(node.kind === "end" && node.value.op === "literal");
    assert.deepEqual(node.value.value, expected);
    frozenDetached(result.workflow, original);
    frozenDetached(node.value.value, value);
    assert.equal(original.graphs.main!.nodes.length, 0);
  });
}

const cycle: unknown[] = []; cycle.push(cycle);
class Exotic { value = 1; }
const rejected: [string, unknown][] = [
  ["sparse", new Array(1)], ["extended", Object.assign([null], { extra: null })],
  ["cycle", cycle], ["symbol", Object.assign([], { [Symbol("extra")]: null })],
  ["hidden index", Object.defineProperty([null], "0", { enumerable: false })],
  ["hidden extra", Object.defineProperty([null], "extra", { value: null })],
  ["hidden object property", Object.defineProperty({}, "extra", { value: null })],
  ["Date", new Date(0)], ["Map", new Map()], ["Set", new Set()], ["class", new Exotic()],
  ["undefined", undefined], ["NaN", NaN], ["infinity", Infinity], ["bigint", 1n],
];
for (const [name, value] of rejected) test(`both boundaries reject ${name}`, () => {
  assert.throws(() => validate({ result: value }), /JSON|array|data property/);
  rejectAuthoring(value, /JSON|data property/);
});
for (const array of [false, true]) test(`accessor rejected without execution (array=${array})`, () => {
  let calls = 0;
  const value = Object.defineProperty(array ? [null] : {}, array ? "0" : "value", {
    enumerable: true, get() { calls++; return null; },
  });
  assert.throws(() => validate({ result: value }), /data property/);
  assert.equal(calls, 0);
  rejectAuthoring(value, /data property/);
  assert.equal(calls, 0);
});
test("output root still must match object schema", () => {
  assert.throws(() => validate([]), /Invalid structured output/);
});
