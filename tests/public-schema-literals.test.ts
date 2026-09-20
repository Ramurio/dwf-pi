import test from "node:test";
import assert from "node:assert/strict";
import { portableInputSchema, type InputSchema } from "../src/public-schema.js";
import { createOutputValidator } from "../src/output-schema.js";

const root = (payload: unknown): InputSchema => ({ type: "object", properties: { payload }, required: ["payload"], additionalProperties: false });
const literal = { $id: "data", $ref: "Thing", $defs: { Ghost: { type: "string" } } };

test("portable const preserves the original accepted data, not rewritten keyword data", () => {
  const original = root({ const: literal });
  const corrupted = { $ref: "#/$defs/Thing" };
  const control = createOutputValidator(original);
  assert.deepEqual(control({ payload: literal }), { payload: literal });
  assert.throws(() => control({ payload: corrupted }));
  const portable = portableInputSchema(original);
  console.log("const conversion:", JSON.stringify({ before: original, after: portable }));
  const validate = createOutputValidator(portable);
  assert.deepEqual(validate({ payload: literal }), { payload: literal });
  assert.throws(() => validate({ payload: corrupted }));
  assert.deepEqual(portable, original);
});

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

for (const keyword of ["const", "enum", "default", "examples"]) for (const data of [literal, [literal, [literal]]]) {
  test(`${keyword} preserves literal ${Array.isArray(data) ? "arrays" : "objects"}`, () => {
    const annotation = keyword === "enum" || keyword === "examples" ? [data] : data;
    const schema = freeze(root({ [keyword]: annotation }));
    const snapshot = structuredClone(schema);
    const converted = portableInputSchema(schema);
    assert.deepEqual(converted, snapshot);
    assert.deepEqual(schema, snapshot);
    assert.equal(converted.$defs, undefined);
    assert.deepEqual(portableInputSchema(converted), converted);
    for (const candidate of [schema, converted]) {
      const validate = createOutputValidator(candidate);
      validate({ payload: data });
      if (keyword === "const" || keyword === "enum") assert.throws(() => validate({ payload: {} }));
    }
  });
}

test("property names are data; child refs and escaped recursive definitions are schemas", () => {
  const name = "a/b~c";
  const definition = { $id: name, type: "object", properties: { value: { type: "string" }, child: { $ref: name } }, required: ["value"], additionalProperties: false };
  const schema: InputSchema = freeze({ type: "object", properties: Object.fromEntries(["$id", "$ref", "$defs", "__proto__"].map(key => [key, { $defs: { [name]: definition }, $ref: name }])), required: ["$id", "$ref", "$defs"], additionalProperties: false });
  const snapshot = structuredClone(schema);
  const converted = portableInputSchema(schema);
  assert.deepEqual(Object.keys(converted.properties), Object.keys(schema.properties));
  assert.deepEqual(converted.properties.$defs, { $ref: "#/$defs/a~1b~0c" });
  assert.deepEqual(Object.keys(converted.$defs!), [name]);
  assert.deepEqual(schema, snapshot);
  assert.deepEqual(portableInputSchema(converted), converted);
  const validate = createOutputValidator(converted);
  const good = { $id: { value: "a" }, $ref: { value: "b", child: { value: "c" } }, $defs: { value: "d" } };
  validate(good);
  assert.throws(() => validate({ ...good, $ref: { value: "b", child: { value: 3 } } }));
});

test("definitions merge structurally and reject actual collisions without mutation", () => {
  const bundle = (a: unknown, b: unknown) => root({ allOf: [{ $defs: { A: a }, $ref: "A" }, { $defs: { A: b }, $ref: "A" }] });
  const a = { type: "object", const: { $id: "literal", $defs: { A: false }, a: 1 } };
  const b = { const: { a: 1, $defs: { A: false }, $id: "literal" }, type: "object" };
  const schema = freeze(bundle(a, b));
  const snapshot = structuredClone(schema);
  const converted = portableInputSchema(schema);
  assert.deepEqual({ ...converted.$defs }, { A: a });
  createOutputValidator(converted)({ payload: a.const });
  assert.deepEqual(schema, snapshot);
  for (const different of [{ type: "string" }, { ...a, const: { ...a.const, $id: "different" } }, { ...a, const: [1, 2] }]) {
    const conflict = freeze(bundle(a, different));
    const before = structuredClone(conflict);
    assert.throws(() => portableInputSchema(conflict), /Conflicting MCP schema definition: A/);
    assert.deepEqual(conflict, before);
  }
  assert.throws(() => portableInputSchema(bundle({ enum: [1, 2] }, { enum: [2, 1] })), /Conflicting MCP schema definition: A/);
});

for (const key of ["properties", "patternProperties", "definitions", "dependentSchemas", "dependencies"]) test(`schema map ${key}`, () => {
  const schema = root({ [key]: { $id: { $id: "remove", $defs: { A: true }, $ref: "A" } } });
  const converted = portableInputSchema(schema);
  assert.deepEqual(converted.properties.payload, { [key]: { $id: { $ref: "#/$defs/A" } } });
  assert.deepEqual({ ...converted.$defs }, { A: true });
});
for (const key of ["items", "prefixItems", "allOf", "anyOf", "oneOf", "additionalItems", "additionalProperties", "unevaluatedProperties", "unevaluatedItems", "propertyNames", "contains", "not", "if", "then", "else", "contentSchema"]) test(`schema child ${key}`, () => {
  const array = ["prefixItems", "allOf", "anyOf", "oneOf"].includes(key);
  const child = { $id: "remove", $defs: { A: false }, $ref: "A" };
  const converted = portableInputSchema(root({ [key]: array ? [child, true] : child }));
  const expected = { $ref: "#/$defs/A" };
  assert.deepEqual(converted.properties.payload, { [key]: array ? [expected, true] : expected });
  assert.deepEqual({ ...converted.$defs }, { A: false });
});

test("draft-07 tuple items, boolean schemas and dependency name arrays validate", () => {
  const schema = { ...root({ type: "array", items: [{ $defs: { A: { type: "string" } }, $ref: "A" }, true], additionalItems: false }), $schema: "http://json-schema.org/draft-07/schema#", dependencies: { payload: ["payload"] } };
  const converted = portableInputSchema(freeze(schema));
  assert.deepEqual((converted as typeof schema).dependencies, schema.dependencies);
  const validate = createOutputValidator(converted);
  validate({ payload: ["ok", 1] });
  assert.throws(() => validate({ payload: [1] }));
  assert.throws(() => validate({ payload: ["ok", 1, 2] }));
  const opaque = JSON.parse('{"__proto__":{"$id":"data"},"unknown":{"$ref":"data"}}');
  assert.deepEqual(portableInputSchema(root({ default: opaque })), root({ default: opaque }));
});
