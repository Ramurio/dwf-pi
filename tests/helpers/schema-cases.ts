// Independent literal expectations for the pinned Ajv 8.20.0 diagnostics.
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export const invalidSchemaCases = freeze({
  "root-array": { schema: { type: "array" }, message: "Output schema must have root type object for submit_result tool arguments" },
  "unknown-keyword": { schema: { type: "object", typo: true }, message: 'strict mode: unknown keyword: "typo"' },
  "invalid-property-type": { schema: { type: "object", properties: { x: { type: "banana" } } }, message: "schema is invalid: data/properties/x/type must be equal to one of the allowed values, data/properties/x/type must be array, data/properties/x/type must match a schema in anyOf" },
  "remote-ref": { schema: { type: "object", $ref: "https://remote.example/schema" }, message: "Remote or external schema references are unsupported" },
  "remote-dynamic-ref": { schema: { type: "object", $dynamicRef: "https://remote.example/schema" }, message: "Remote or external schema references are unsupported" },
  async: { schema: { type: "object", $async: true }, message: "Async output schemas are unsupported" },
  "unsupported-dialect": { schema: { type: "object", $schema: "https://unsupported.example" }, message: "Unsupported output schema dialect: https://unsupported.example" },
  "unknown-email-format": { schema: { type: "object", properties: { id: { type: "string", format: "email" } } }, message: 'unknown format "email" ignored in schema at path "#/properties/id"' },
  "missing-local-ref": { schema: { type: "object", properties: { count: { $ref: "#/$defs/missing" } } }, message: "can't resolve reference #/$defs/missing from id #" },
});

// This boundary deliberately covers the original six cases, not a positional subset.
export const prepareSchemaCaseIds = freeze([
  "root-array", "unknown-keyword", "invalid-property-type", "remote-ref", "async", "unsupported-dialect",
] as const satisfies readonly (keyof typeof invalidSchemaCases)[]);

export const validSchemaCases = freeze({
  "answer-override": { schema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"] } },
  "local-ref": { schema: { type: "object", properties: { count: { $ref: "#/$defs/count" } }, required: ["count"], additionalProperties: false, $defs: { count: { type: "integer", minimum: 1 } } } },
  "draft7-tuple": { schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { tuple: { type: "array", items: [{ type: "number" }], additionalItems: false } } } },
  "literal-ref": { schema: { type: "object", const: { $ref: "https://literal.example" } } },
  "count-with-default": { schema: { type: "object", properties: { count: { type: "integer", default: 3 } }, required: ["count"], additionalProperties: false } },
});
