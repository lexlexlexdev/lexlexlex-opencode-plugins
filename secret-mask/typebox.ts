/**
 * Minimal stand-in for the `typebox` import of the ported extension.
 * OpenCode accepts a plain JSON Schema for tool input, which is all the extension needs.
 */
type OptionalMark = { readonly [OPTIONAL]?: true };
const OPTIONAL = Symbol("secret-mask.optional");

interface JsonSchema {
  [key: string]: unknown;
}

function isOptional(schema: JsonSchema): boolean {
  return (schema as OptionalMark)[OPTIONAL] === true;
}

function strip(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema };
  delete (out as OptionalMark)[OPTIONAL];
  return out;
}

export const Type = {
  String(options: JsonSchema = {}): JsonSchema {
    return { type: "string", ...options };
  },
  Number(options: JsonSchema = {}): JsonSchema {
    return { type: "number", ...options };
  },
  Boolean(options: JsonSchema = {}): JsonSchema {
    return { type: "boolean", ...options };
  },
  Array(items: JsonSchema, options: JsonSchema = {}): JsonSchema {
    return { type: "array", items: strip(items), ...options };
  },
  Optional(schema: JsonSchema): JsonSchema {
    return { ...schema, [OPTIONAL]: true };
  },
  Object(properties: Record<string, JsonSchema>, options: JsonSchema = {}): JsonSchema {
    const required = Object.keys(properties).filter((key) => !isOptional(properties[key]));
    const plain: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(properties)) plain[key] = strip(value);
    const schema: JsonSchema = { type: "object", properties: plain, additionalProperties: false, ...options };
    if (required.length > 0) schema.required = required;
    return schema;
  },
};
