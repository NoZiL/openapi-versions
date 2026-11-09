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
 *  - `anyOf`/`oneOf` members:                   UNION; a member in both (same `$ref`, same type) is merged
 *  - a schema whose shape changes (`$ref` target, `allOf`/`anyOf`/`oneOf`, inline): `anyOf` of both
 *    shapes, so either is typed. A null wrapper (`anyOf: [{$ref}, {type: "null"}]`, 3.0 `nullable` +
 *    one `allOf` member) is looked through, so gaining or losing one is not a reshape.
 *    Under `not`/`if`…, where accepting more rejects more, the newest shape wins.
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
    // a union keeps every member a minor in range has (not under `not`/`if`…, where that would reject more)
    if (kind === "schema" && ctx.widen && UNIONS.has(key) && Array.isArray(older[key]) && Array.isArray(newer[key])) {
      out[key] = mergeMembers(older[key], newer[key], ctx);
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
  const o = unwrapNull(older);
  const n = unwrapNull(newer);
  if (!ctx.widen || (!o.wrapped && !n.wrapped && shape(older) === shape(newer))) {
    // reshaped under `not`/`if`…: accepting either shape would change what the parent accepts
    if (shape(older) !== shape(newer)) return newer;
    return widenNull(mergeKeys(older, newer, "schema", ctx), older, newer, ctx);
  }
  // reshaped, or behind a null wrapper: mixing both shapes' keys would leave a `$ref` next to the
  // other shape (generators read only the `$ref`) or intersect them. Merge what each side wraps,
  // member by member, so every shape a minor in range sends is typed.
  const a = unionOf(o.core);
  const b = unionOf(n.core);
  const members = mergeMembers(a.members, b.members, ctx);
  const keyword = a.keyword === "oneOf" && b.keyword === "oneOf" ? "oneOf" : "anyOf";
  let core: Json = members.length === 1 ? members[0] : { [keyword]: members };
  if ((o.nullable || n.nullable) && !acceptsNull(core)) {
    core = members.length > 1 && !ctx.oas30 ? { [keyword]: [...members, { type: "null" }] } : withNull(core, ctx.oas30);
  }
  // annotations: newest wins, as everywhere else
  const notes = { ...o.notes, ...n.notes };
  return Object.keys(notes).length && isObj(core) ? { ...notes, ...core } : core;
}

function widenNull(out: Json, older: Json, newer: Json, ctx: Ctx): Json {
  if (!ctx.widen || acceptsNull(out) || !(acceptsNull(older) || acceptsNull(newer))) return out;
  return withNull(out, ctx.oas30);
}

const COMPOSITIONS = ["allOf", "anyOf", "oneOf"];
const UNIONS = new Set(["anyOf", "oneOf"]);

/** `$ref` target, composition keywords, or "" for an inline schema: merging key by key is only sound within one shape. */
function shape(s: Json): string {
  if (!isObj(s)) return "";
  if ("$ref" in s) return `$ref ${s.$ref}`;
  return COMPOSITIONS.filter((k) => k in s).join(",");
}

/** Keywords that describe a schema without constraining it. */
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
  /** the schema without its annotations, and without its null wrapper if it had one */
  core: Json;
  /** a null wrapper was removed: `anyOf`/`oneOf` with a null member, or 3.0 `nullable: true` + one `allOf` member */
  wrapped: boolean;
  nullable: boolean;
  notes: Record<string, Json>;
}

function unwrapNull(s: Record<string, Json>): Unwrapped {
  const notes = Object.fromEntries(Object.entries(s).filter(([k]) => isAnnotation(k)));
  const rest = Object.fromEntries(Object.entries(s).filter(([k]) => !isAnnotation(k)));
  const keys = Object.keys(rest);
  if (keys.length === 2 && rest.nullable === true && Array.isArray(rest.allOf) && rest.allOf.length === 1) {
    return { core: rest.allOf[0], wrapped: true, nullable: true, notes };
  }
  if (keys.length === 1 && UNIONS.has(keys[0]) && Array.isArray(rest[keys[0]])) {
    const kept = rest[keys[0]].filter((m: Json) => !isNullOnly(m));
    if (kept.length > 0 && kept.length < rest[keys[0]].length) {
      return { core: kept.length === 1 ? kept[0] : { [keys[0]]: kept }, wrapped: true, nullable: true, notes };
    }
  }
  return { core: rest, wrapped: false, nullable: false, notes };
}

/** Members of a bare `anyOf`/`oneOf` (no other keywords), else the schema itself. */
function unionOf(s: Json): { keyword?: string; members: Json[] } {
  const keys = isObj(s) ? Object.keys(s) : [];
  if (keys.length === 1 && UNIONS.has(keys[0]) && Array.isArray(s[keys[0]])) return { keyword: keys[0], members: s[keys[0]] };
  return { members: [s] };
}

/** Key-order independent JSON, to compare schemas. */
const canon = (x: Json): string =>
  JSON.stringify(x, (_k, v) => (isObj(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

/** What a union member is, so the same member in two minors is merged rather than listed twice. */
function memberKey(m: Json): string {
  if (!isObj(m)) return canon(m);
  if (isNullOnly(m)) return "null";
  if ("$ref" in m) return `$ref ${m.$ref}`;
  if (COMPOSITIONS.some((k) => k in m)) return canon(m);
  const types = (Array.isArray(m.type) ? m.type : [m.type ?? "any"]).filter((t: Json) => t !== "null");
  return `type ${[...types].sort().join(",")}`;
}

/** Union of `anyOf`/`oneOf` members, older first; a member present in both is merged. */
function mergeMembers(older: Json[], newer: Json[], ctx: Ctx): Json[] {
  const out = [...older];
  for (const m of newer) {
    const i = out.findIndex((x) => memberKey(x) === memberKey(m));
    if (i < 0) out.push(m);
    else out[i] = merge(out[i], m, "schema", ctx);
  }
  return out;
}

const hasNull = (t: unknown) => t === "null" || (Array.isArray(t) && t.includes("null"));

function acceptsNull(s: Json): boolean {
  if (!isObj(s)) return false;
  if (s.nullable === true) return true;
  // an explicit type decides: a null in `enum` or `const` does not get past `type: "string"`
  if (s.type !== undefined) return hasNull(s.type);
  if (s.const === null || (Array.isArray(s.enum) && s.enum.includes(null))) return true;
  return [...UNIONS].some((k) => Array.isArray(s[k]) && s[k].some(acceptsNull));
}

/** `s`, also accepting null, in the form the document's OpenAPI version understands. */
function withNull(s: Record<string, Json>, oas30: boolean): Json {
  if ("$ref" in s || COMPOSITIONS.some((k) => k in s)) {
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
