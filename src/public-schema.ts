export type InputSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false; $defs?: Record<string, unknown>; oneOf?: unknown[] };

/** TypeBox embeds named cyclic definitions more than once; publish one portable local-$ref bundle. */
export function portableInputSchema(value: InputSchema): InputSchema {
  const definitions: Record<string, unknown> = Object.create(null);
  function rewrite(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value === null || typeof value !== "object") return value;
    const schema = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    if (schema.$defs && typeof schema.$defs === "object") for (const [name, definition] of Object.entries(schema.$defs)) {
      const rewritten = rewrite(definition);
      if (Object.hasOwn(definitions, name) && JSON.stringify(definitions[name]) !== JSON.stringify(rewritten)) throw new Error(`Conflicting MCP schema definition: ${name}`);
      definitions[name] = rewritten;
    }
    for (const [key, item] of Object.entries(schema)) {
      if (key === "$defs" || key === "$id") continue;
      result[key] = key === "$ref" && typeof item === "string" && !item.startsWith("#")
        ? `#/$defs/${item.replace(/~/g, "~0").replace(/\//g, "~1")}` : rewrite(item);
    }
    return result;
  }
  const schema = rewrite(value) as InputSchema;
  if (Object.keys(definitions).length) schema.$defs = definitions;
  return schema;
}

