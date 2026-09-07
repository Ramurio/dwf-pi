import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Json } from "./graph.js";

/** JSON transport boundary: reject coercion, getters, cycles, sparse arrays and exotic objects. */
export function assertJson(value: unknown, path = "$", ancestors = new Set<object>()): asserts value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new Error(`${path}: expected JSON value`);
  if (ancestors.has(value)) throw new Error(`${path}: cyclic JSON value`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(`${path}: expected plain JSON object`);
  if (Object.getOwnPropertySymbols(value).length) throw new Error(`${path}: symbol keys are not JSON`);
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new Error(`${path}: sparse or extended array`);
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === "length") continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${path}.${key}: expected enumerable JSON data property`);
    assertJson(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

export const defaultOutputSchema = {
  type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false,
} as const;

/** Compile a synchronous tool-argument schema once; validation never mutates/coerces values. */
export function createOutputValidator(schema: Record<string, unknown>): (value: unknown) => Json {
  assertJson(schema);
  if (schema === null || Array.isArray(schema) || schema.type !== "object") throw new Error("Output schema must have root type object for submit_result tool arguments");
  inspectSchema(schema);
  const options = { strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false, allowUnionTypes: true, strictTuples: false } as const;
  const dialect = schema.$schema;
  if (dialect !== undefined && dialect !== "https://json-schema.org/draft/2020-12/schema" && dialect !== "http://json-schema.org/draft-07/schema#" && dialect !== "https://json-schema.org/draft-07/schema#") throw new Error(`Unsupported output schema dialect: ${String(dialect)}`);
  const engine = dialect === "http://json-schema.org/draft-07/schema#" || dialect === "https://json-schema.org/draft-07/schema#" ? new Ajv(options) : new Ajv2020(options);
  const copy = structuredClone(schema);
  if (dialect === "https://json-schema.org/draft-07/schema#") copy.$schema = "http://json-schema.org/draft-07/schema#";
  const validate = engine.compile(copy);
  return (value) => {
    assertJson(value);
    if (!validate(value)) throw new Error(`Invalid structured output: ${engine.errorsText(validate.errors, { separator: "; " })}`);
    return structuredClone(value);
  };
}

// Inspect schema positions only: const/examples/default can contain arbitrary JSON, including "$ref" keys.
function inspectSchema(schema: unknown): void {
  if (typeof schema === "boolean") return;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return; // Ajv reports malformed schemas.
  const object = schema as Record<string, unknown>;
  if (Object.hasOwn(object, "$async")) throw new Error("Async output schemas are unsupported");
  for (const key of ["$ref", "$dynamicRef", "$recursiveRef"]) {
    if (typeof object[key] === "string" && !object[key].startsWith("#")) throw new Error("Remote or external schema references are unsupported");
  }
  for (const key of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]) {
    const collection = object[key];
    if (collection && typeof collection === "object" && !Array.isArray(collection)) for (const child of Object.values(collection)) inspectSchema(child);
  }
  const dependencies = object.dependencies;
  if (dependencies && typeof dependencies === "object" && !Array.isArray(dependencies)) for (const child of Object.values(dependencies)) if (!Array.isArray(child)) inspectSchema(child);
  for (const key of ["items", "prefixItems", "allOf", "anyOf", "oneOf", "additionalItems", "additionalProperties", "unevaluatedProperties", "unevaluatedItems", "propertyNames", "contains", "not", "if", "then", "else", "contentSchema"]) {
    const child = object[key];
    if (Array.isArray(child)) child.forEach(inspectSchema); else if (child !== undefined) inspectSchema(child);
  }
}
