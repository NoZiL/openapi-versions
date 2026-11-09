/**
 * Tolerant merge of several OpenAPI documents of the SAME major version.
 *
 * Result describes every input version at once:
 *  - paths, operations, properties, parameters: UNION
 *  - `required` arrays (schema objects):        INTERSECTION
 *  - `required` booleans (params, bodies):      AND (true only if every version says true)
 *  - enums:                                     UNION of values
 *  - a schema accepting null in any version:    accepts null (`nullable`, `"null"` in `type`, a null
 *    `anyOf`/`oneOf` member…), so a backend still on an older minor that sends `null` is typed.
 *    oasdiff lets a response drop null; it flags a request doing so, so inputs never get here.
 *  - a schema that is a `$ref` in one version and not in the other: newest wins as a whole
 *  - everything else (descriptions, formats…):  newest wins
 *
 * Inputs MUST be non-breaking relative to each other (checked by oasdiff first),
 * otherwise the union can describe a shape no server ever had.
 */

type Json = any;
const isObj = (x: unknown): x is Record<string, Json> => !!x && typeof x === "object" && !Array.isArray(x);
const isParamList = (a: unknown[]) => a.length > 0 && a.every((p) => isObj(p) && typeof p.name === "string" && typeof p.in === "string");

/**
 * What the value being merged is: document structure, a Schema Object, a map of names to schemas
 * (`properties`, `components.schemas`), or literal data (`example`, `default`, `x-*`) merged with no
 * keyword rules, so a property named `required` or an example with a `type` key is left alone.
 */
type Kind = "doc" | "schema" | "schemas" | "literal";

const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const SUBSCHEMAS = new Set([
  "items",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
]);
const LITERALS = new Set(["example", "examples", "default", "const", "enum"]);

function childKind(kind: Kind, key: string): Kind {
  if (kind === "literal" || key.startsWith("x-") || LITERALS.has(key)) return "literal";
  if (kind === "schemas") return "schema";
  if (kind === "schema") return SCHEMA_MAPS.has(key) ? "schemas" : SUBSCHEMAS.has(key) ? "schema" : "literal";
  return key === "schema" ? "schema" : key === "schemas" ? "schemas" : "doc";
}

export function mergeTolerant(older: Json, newer: Json): Json {
  const version = (isObj(newer) && newer.openapi) || (isObj(older) && older.openapi);
  return merge(older, newer, "doc", typeof version === "string" && version.startsWith("3.0"));
}

function merge(older: Json, newer: Json, kind: Kind, oas30: boolean): Json {
  if (older === undefined) return newer;
  if (newer === undefined) return older;

  if (Array.isArray(older) && Array.isArray(newer)) {
    if (kind === "doc" && (isParamList(older) || isParamList(newer))) return mergeParams(older, newer, oas30);
    // enums, `type: ["string","null"]`, tags… -> union of primitives, keep order
    if ([...older, ...newer].every((v) => !isObj(v) && !Array.isArray(v))) return [...new Set([...older, ...newer])];
    return newer;
  }

  if (!isObj(older) || !isObj(newer)) return newer;
  if (kind === "schema") return mergeSchema(older, newer, oas30);

  const out: Record<string, Json> = {};
  for (const key of new Set([...Object.keys(older), ...Object.keys(newer)])) {
    if (key === "required" && kind === "doc") {
      const required = mergeRequired(older, newer);
      if (required !== undefined) out.required = required;
      continue;
    }
    out[key] = merge(older[key], newer[key], childKind(kind, key), oas30);
  }
  return out;
}

function mergeRequired(older: Record<string, Json>, newer: Record<string, Json>): Json {
  const a = older.required;
  const b = newer.required;
  // Parameter / requestBody: boolean. Missing means false.
  if (typeof a === "boolean" || typeof b === "boolean") return a === true && b === true;
  // Schema object: string[]. Missing means nothing required.
  const aa: string[] = Array.isArray(a) ? a : [];
  const bb: string[] = Array.isArray(b) ? b : [];
  const both = aa.filter((r) => bb.includes(r));
  return both.length || Array.isArray(a) || Array.isArray(b) ? both : undefined;
}

function mergeSchema(older: Record<string, Json>, newer: Record<string, Json>, oas30: boolean): Json {
  let out: Record<string, Json>;
  if ("$ref" in older !== "$ref" in newer) {
    // reshaped (inlined, or wrapped as `anyOf: [{$ref}, {type: "null"}]`): mixing both shapes' keys
    // would leave a `$ref` next to the other shape, and generators read only the `$ref`
    out = newer;
  } else {
    out = {};
    for (const key of new Set([...Object.keys(older), ...Object.keys(newer)])) {
      if (key === "required") {
        const required = mergeRequired(older, newer);
        if (required !== undefined) out.required = required;
        continue;
      }
      out[key] = merge(older[key], newer[key], childKind("schema", key), oas30);
    }
  }
  return (acceptsNull(older) || acceptsNull(newer)) && !acceptsNull(out) ? withNull(out, oas30) : out;
}

const hasNull = (t: unknown) => t === "null" || (Array.isArray(t) && t.includes("null"));

function acceptsNull(s: Json): boolean {
  if (!isObj(s)) return false;
  if (s.nullable === true || hasNull(s.type) || s.const === null || (Array.isArray(s.enum) && s.enum.includes(null))) return true;
  return ["anyOf", "oneOf"].some((k) => Array.isArray(s[k]) && s[k].some(acceptsNull));
}

/** `s`, also accepting null, in the form the document's OpenAPI version understands. */
function withNull(s: Record<string, Json>, oas30: boolean): Json {
  if ("$ref" in s || ["allOf", "anyOf", "oneOf"].some((k) => k in s)) {
    return oas30 ? { nullable: true, allOf: [s] } : { anyOf: [s, { type: "null" }] };
  }
  if (s.type === undefined) return s; // untyped: already accepts anything
  if (oas30) return { ...s, nullable: true };
  const types = Array.isArray(s.type) ? s.type : [s.type];
  return { ...s, type: [...types, "null"], ...(Array.isArray(s.enum) && { enum: [...s.enum, null] }) };
}

function mergeParams(older: Json[], newer: Json[], oas30: boolean): Json[] {
  const key = (p: Json) => `${p.in}:${p.name}`;
  const olderByKey = new Map(older.map((p) => [key(p), p]));
  const out: Json[] = [];
  for (const p of newer) {
    const o = olderByKey.get(key(p));
    // param that only exists in some versions can never be required
    out.push(o ? merge(o, p, "doc", oas30) : { ...p, required: p.in === "path" });
    olderByKey.delete(key(p));
  }
  for (const p of olderByKey.values()) out.push({ ...p, required: p.in === "path" });
  return out;
}

export const mergeAll = (docs: Json[]): Json => docs.reduce((acc, d) => mergeTolerant(acc, d));
