/**
 * Tolerant merge of several OpenAPI documents of the SAME major version.
 *
 * Result describes every input version at once:
 *  - paths, operations, properties, parameters: UNION
 *  - `required` arrays (schema objects):        INTERSECTION
 *  - `required` booleans (params, bodies):      AND (true only if every version says true)
 *  - enums:                                     UNION of values
 *  - everything else (descriptions, formats…):  newest wins
 *
 * Inputs MUST be non-breaking relative to each other (checked by oasdiff first),
 * otherwise the union can describe a shape no server ever had.
 */

type Json = any;
const isObj = (x: unknown): x is Record<string, Json> => !!x && typeof x === "object" && !Array.isArray(x);
const isParamList = (a: unknown[]) => a.length > 0 && a.every((p) => isObj(p) && typeof p.name === "string" && typeof p.in === "string");

export function mergeTolerant(older: Json, newer: Json): Json {
  if (older === undefined) return newer;
  if (newer === undefined) return older;

  if (Array.isArray(older) && Array.isArray(newer)) {
    if (isParamList(older) || isParamList(newer)) return mergeParams(older, newer);
    // enums, `type: ["string","null"]`, tags… -> union of primitives, keep order
    if ([...older, ...newer].every((v) => !isObj(v) && !Array.isArray(v))) return [...new Set([...older, ...newer])];
    return newer;
  }

  if (isObj(older) && isObj(newer)) {
    const out: Record<string, Json> = {};
    for (const key of new Set([...Object.keys(older), ...Object.keys(newer)])) {
      if (key === "required") {
        out.required = mergeRequired(older, newer);
        continue;
      }
      out[key] = mergeTolerant(older[key], newer[key]);
    }
    if (out.required === undefined) delete out.required;
    return out;
  }

  return newer;
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

function mergeParams(older: Json[], newer: Json[]): Json[] {
  const key = (p: Json) => `${p.in}:${p.name}`;
  const olderByKey = new Map(older.map((p) => [key(p), p]));
  const out: Json[] = [];
  for (const p of newer) {
    const o = olderByKey.get(key(p));
    // param that only exists in some versions can never be required
    out.push(o ? mergeTolerant(o, p) : { ...p, required: p.in === "path" });
    olderByKey.delete(key(p));
  }
  for (const p of olderByKey.values()) out.push({ ...p, required: p.in === "path" });
  return out;
}

export const mergeAll = (docs: Json[]) => docs.reduce((acc, d) => mergeTolerant(acc, d));
