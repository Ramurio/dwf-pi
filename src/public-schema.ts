export type InputSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false; $defs?: Record<string, unknown>; oneOf?: unknown[] };

// Unknown vocabulary values are JSON data, not implicitly schema positions.
const schemaMaps = new Set(["properties", "patternProperties", "definitions", "dependentSchemas"]);
const schemaChildren = new Set(["items", "prefixItems", "allOf", "anyOf", "oneOf", "additionalItems", "additionalProperties", "unevaluatedProperties", "unevaluatedItems", "propertyNames", "contains", "not", "if", "then", "else", "contentSchema"]);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function copy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copy);
  return isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;
}
// Canonical JSON comparison ignores object insertion order, but preserves array order.
function canonical(value: unknown): string | undefined {
  function sort(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sort);
    return isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  }
  return JSON.stringify(sort(value));
}

/** TypeBox embeds named cyclic definitions more than once; publish one portable local-$ref bundle. */
export function portableInputSchema(value: InputSchema): InputSchema {
  const definitions: Record<string, unknown> = Object.create(null);
  function rewrite(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!isObject(value)) return value;
    const schema = value as Record<string, unknown>;
    const entries: [string, unknown][] = [];
    if (isObject(schema.$defs)) for (const [name, definition] of Object.entries(schema.$defs)) {
      const rewritten = rewrite(definition);
      if (Object.hasOwn(definitions, name) && canonical(definitions[name]) !== canonical(rewritten)) throw new Error(`Conflicting MCP schema definition: ${name}`);
      definitions[name] = rewritten;
    }
    for (const [key, item] of Object.entries(schema)) {
      if (key === "$defs" || key === "$id") continue;
      let rewritten: unknown;
      if (key === "$ref" && typeof item === "string" && !item.startsWith("#")) {
        rewritten = `#/$defs/${item.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      } else if ((schemaMaps.has(key) || key === "dependencies") && isObject(item)) {
        rewritten = Object.fromEntries(Object.entries(item).map(([name, child]) =>
          [name, key === "dependencies" && Array.isArray(child) ? copy(child) : rewrite(child)]));
      } else rewritten = schemaChildren.has(key) ? rewrite(item) : copy(item);
      entries.push([key, rewritten]);
    }
    return Object.fromEntries(entries);
  }
  const schema = rewrite(value) as InputSchema;
  if (Object.keys(definitions).length) schema.$defs = definitions;
  return schema;
}

