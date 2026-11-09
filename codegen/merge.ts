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
 *  - a schema whose shape changes (`$ref` target, `allOf`/`anyOf`/`oneOf`, inline): `anyOf` of both
 *    shapes, so either is typed; a shape change that only adds or drops a null wrapper merges what it wraps
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
 * keyword rules. Keys are read as keywords only where they are keywords, so a property, header or
 * response named `required` or `default` keeps its own merge rules.
 */
type Kind = "doc" | "schema" | "schemas" | "literal";

interface Ctx {
  oas30: boolean;
  /** false under `not`, `if`, `contains`…: accepting null there would change what the parent accepts */
  widen: boolean;
}

const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const VALUE_SCHEMAS = new Set(["items", "additionalItems", "additionalProperties", "unevaluatedItems", "unevaluatedProperties"]);
const CONDITION_SCHEMAS = new Set(["not", "if", "then", "else", "contains", "propertyNames"]);

function childKind(kind: Kind, key: string): Kind {
  if (kind === "literal") return "literal";
  if (kind === "schemas") return "schema"; // every key is a name, whatever it is
  if (key.startsWith("x-")) return "literal";
  if (kind === "schema") {
    if (SCHEMA_MAPS.has(key)) return "schemas";
    return VALUE_SCHEMAS.has(key) || CONDITION_SCHEMAS.has(key) ? "schema" : "literal";
  }
  // doc: `default` here is a response code, not a literal
  if (key === "example" || key === "examples") return "literal";
  return key === "schema" ? "schema" : key === "schemas" ? "schemas" : "doc";
}

export function mergeTolerant(older: Json, newer: Json): Json {
  const version = (isObj(newer) && newer.openapi) || (isObj(older) && older.openapi);
  return merge(older, newer, "doc", { oas30: typeof version === "string" && version.startsWith("3.0"), widen: true });
}

function merge(older: Json, newer: Json, kind: Kind, ctx: Ctx): Json {
  if (older === undefined) return newer;
  if (newer === undefined) return older;

  if (Array.isArray(older) && Array.isArray(newer)) {
    if (kind === "doc" && (isParamList(older) || isParamList(newer))) return mergeParams(older, newer, ctx);
    // enums, `type: ["string","null"]`, tags… -> union of primitives, keep order
    if ([...older, ...newer].every((v) => !isObj(v) && !Array.isArray(v))) return [...new Set([...older, ...newer])];
    return newer;
  }

  if (!isObj(older) || !isObj(newer)) return newer;
  return kind === "schema" ? mergeSchema(older, newer, ctx) : mergeKeys(older, newer, kind, ctx);
}

function mergeKeys(older: Record<string, Json>, newer: Record<string, Json>, kind: Kind, ctx: Ctx): Record<string, Json> {
  const isRequired = (v: unknown) => typeof v === "boolean" || Array.isArray(v);
  const out: Record<string, Json> = {};
  for (const key of new Set([...Object.keys(older), ...Object.keys(newer)])) {
    if (key === "required" && (kind === "doc" || kind === "schema") && (isRequired(older.required) || isRequired(newer.required))) {
      const required = mergeRequired(older.required, newer.required);
      if (required !== undefined) out.required = required;
      continue;
    }
    const child = childKind(kind, key);
    out[key] = merge(older[key], newer[key], child, kind === "schema" && CONDITION_SCHEMAS.has(key) ? { ...ctx, widen: false } : ctx);
  }
  return out;
}

function mergeRequired(a: Json, b: Json): Json {
  // Parameter / requestBody: boolean. Missing means false.
  if (typeof a === "boolean" || typeof b === "boolean") return a === true && b === true;
  // Schema object: string[]. Missing means nothing required.
  const aa: string[] = Array.isArray(a) ? a : [];
  const bb: string[] = Array.isArray(b) ? b : [];
  const both = aa.filter((r) => bb.includes(r));
  return both.length || Array.isArray(a) || Array.isArray(b) ? both : undefined;
}

function mergeSchema(older: Record<string, Json>, newer: Record<string, Json>, ctx: Ctx): Json {
  if (shape(older) === shape(newer)) return widenNull(mergeKeys(older, newer, "schema", ctx), older, newer, ctx);
  // reshaped between minors: mixing both shapes' keys would leave a `$ref` next to the other shape
  // (generators read only the `$ref`) or intersect them. Under `not`/`if`… accepting more changes
  // what the parent accepts, so the newest shape wins there.
  if (!ctx.widen) return newer;
  const o = unwrapNull(older);
  const n = unwrapNull(newer);
  const notes = { ...o.notes, ...n.notes };
  // only the null wrapper changed (`anyOf: [{$ref}, {type: "null"}]` <-> `{$ref}`): merge what it wraps
  if (shape(o.core) === shape(n.core)) {
    const core = mergeSchema(o.core, n.core, ctx);
    return withNotes(o.nullable || n.nullable ? withNull(core, ctx.oas30) : core, notes);
  }
  // otherwise accept either shape, so a backend on any minor in range is typed
  const members: Json[] = [];
  for (const m of [...unionMembers(o.core), ...unionMembers(n.core)]) {
    if (!members.some((x) => JSON.stringify(x) === JSON.stringify(m))) members.push(m);
  }
  const union: Record<string, Json> = { anyOf: members };
  if (!(o.nullable || n.nullable) || acceptsNull(union)) return withNotes(union, notes);
  return withNotes(ctx.oas30 ? withNull(union, true) : { anyOf: [...members, { type: "null" }] }, notes);
}

function widenNull(out: Json, older: Json, newer: Json, ctx: Ctx): Json {
  if (!ctx.widen || acceptsNull(out) || !(acceptsNull(older) || acceptsNull(newer))) return out;
  return withNull(out, ctx.oas30);
}

const COMPOSITIONS = ["allOf", "anyOf", "oneOf"] as const;

/** `$ref` target, composition keywords, or "" for an inline schema: merging key by key is only sound within one shape. */
function shape(s: Json): string {
  if (!isObj(s)) return "";
  if ("$ref" in s) return `$ref ${s.$ref}`;
  return COMPOSITIONS.filter((k) => k in s).join(",");
}

/** Keywords that describe a schema without constraining it: they may sit next to a null wrapper. */
const ANNOTATIONS = new Set([
  "title",
  "description",
  "deprecated",
  "readOnly",
  "writeOnly",
  "example",
  "examples",
  "default",
  "externalDocs",
]);
const isAnnotation = (k: string) => ANNOTATIONS.has(k) || k.startsWith("x-");

const isNullOnly = (s: Json) =>
  isObj(s) &&
  (s.type === "null" ||
    (Array.isArray(s.type) && s.type.length === 1 && s.type[0] === "null") ||
    (s.type === undefined && (s.const === null || (Array.isArray(s.enum) && s.enum.length === 1 && s.enum[0] === null))));

interface Unwrapped {
  core: Json;
  nullable: boolean;
  notes: Record<string, Json>;
}

/**
 * Splits a null wrapper (`anyOf`/`oneOf` with a null member, or 3.0 `nullable: true` + one `allOf`
 * member) into what it wraps, so a field reshaped only by gaining or losing null is merged as one shape.
 */
function unwrapNull(s: Record<string, Json>): Unwrapped {
  const keys = Object.keys(s).filter((k) => !isAnnotation(k));
  const notes = Object.fromEntries(Object.entries(s).filter(([k]) => isAnnotation(k)));
  if (keys.length === 2 && s.nullable === true && Array.isArray(s.allOf) && s.allOf.length === 1) {
    return { core: s.allOf[0], nullable: true, notes };
  }
  if (keys.length === 1 && (keys[0] === "anyOf" || keys[0] === "oneOf") && Array.isArray(s[keys[0]])) {
    const rest = s[keys[0]].filter((m: Json) => !isNullOnly(m));
    if (rest.length > 0 && rest.length < s[keys[0]].length) {
      return { core: rest.length === 1 ? rest[0] : { [keys[0]]: rest }, nullable: true, notes };
    }
  }
  return { core: s, nullable: false, notes: {} };
}

/** Members of a bare `anyOf`/`oneOf` (no other keywords), else the schema itself. */
function unionMembers(s: Json): Json[] {
  if (!isObj(s)) return [s];
  const keys = Object.keys(s);
  return keys.length === 1 && (keys[0] === "anyOf" || keys[0] === "oneOf") && Array.isArray(s[keys[0]]) ? s[keys[0]] : [s];
}

const withNotes = (s: Json, notes: Record<string, Json>) => (Object.keys(notes).length && isObj(s) ? { ...notes, ...s } : s);

const hasNull = (t: unknown) => t === "null" || (Array.isArray(t) && t.includes("null"));

function acceptsNull(s: Json): boolean {
  if (!isObj(s)) return false;
  if (s.nullable === true) return true;
  // an explicit type decides: a null in `enum` or `const` does not get past `type: "string"`
  if (s.type !== undefined) return hasNull(s.type);
  if (s.const === null || (Array.isArray(s.enum) && s.enum.includes(null))) return true;
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
  return { ...s, type: [...types, "null"], ...(Array.isArray(s.enum) && !s.enum.includes(null) && { enum: [...s.enum, null] }) };
}

function mergeParams(older: Json[], newer: Json[], ctx: Ctx): Json[] {
  const key = (p: Json) => `${p.in}:${p.name}`;
  const olderByKey = new Map(older.map((p) => [key(p), p]));
  const out: Json[] = [];
  for (const p of newer) {
    const o = olderByKey.get(key(p));
    // param that only exists in some versions can never be required
    out.push(o ? merge(o, p, "doc", ctx) : { ...p, required: p.in === "path" });
    olderByKey.delete(key(p));
  }
  for (const p of olderByKey.values()) out.push({ ...p, required: p.in === "path" });
  return out;
}

export const mergeAll = (docs: Json[]): Json => docs.reduce((acc, d) => mergeTolerant(acc, d));
