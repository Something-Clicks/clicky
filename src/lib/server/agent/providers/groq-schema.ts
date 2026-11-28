/**
 * Prepares the JSON schema the agent already builds for a request to Groq's strict structured-output mode.
 *
 * Groq's strict mode needs every object to list ALL its properties as required and to forbid extra ones. It documents
 * no support for length/size/pattern keywords, so those are left out of what is SENT; they are still enforced here,
 * because `generateStructured` validates every answer against the original schema before anything is stored.
 * Pure and dependency-free, so it can be tested on its own.
 */
const KEEP = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "description", "$ref", "$defs"]);

export function groqStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(groqStrictSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!KEEP.has(key)) continue;
    if (key === "properties" || key === "$defs") {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, groqStrictSchema(v)]));
    } else if (key === "enum" || key === "const" || key === "required") {
      out[key] = value;
    } else {
      out[key] = groqStrictSchema(value);
    }
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.required = Object.keys(out.properties as object);
    out.additionalProperties = false;
  }
  return out;
}
