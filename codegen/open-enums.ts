/**
 * `transform` hooks for EXTENSIBLE enums, one per generator stack (ADR 0017).
 *
 * The backend declares enums that may grow within a major with `x-extensible-enum`
 * (plain `enum` stays closed: adding a value to it is a breaking change, and oasdiff
 * flags it). Extensible enums become OPEN unions:
 *   "active" | "invited" | (string & {})
 * Autocomplete still lists the known values, a value added by a newer backend
 * compiles, and `switch` statements need a `default` branch.
 *
 * - openapi-typesafe: `openEnumsIr`, used with `irCallbacks: true`. Returns type text; no `typescript` needed.
 * - openapi-typescript: `openEnums`, returns a `ts.factory` node. Loads `typescript` on first use only.
 */

import { createRequire } from "node:module";
import type { OpenAPITSOptions } from "openapi-typescript";
import type * as TS from "typescript";

/** The known values of an extensible string enum, or undefined if the schema is not one. */
function extensibleEnum(schema: unknown): { values: string[]; nullable: boolean } | undefined {
  const s = schema as { type?: unknown; "x-extensible-enum"?: unknown };
  const isString = s.type === "string" || (Array.isArray(s.type) && s.type.includes("string"));
  const values = s["x-extensible-enum"];
  if (!isString || !Array.isArray(values) || !values.every((v: unknown) => typeof v === "string")) return undefined;
  return { values, nullable: Array.isArray(s.type) && s.type.includes("null") };
}

/** openapi-typesafe `transform` with `irCallbacks: true`: returns TypeScript type text. */
export const openEnumsIr = (schema: unknown): string | undefined => {
  const e = extensibleEnum(schema);
  if (!e) return undefined;
  return [...e.values.map((v) => JSON.stringify(v)), "(string & {})", ...(e.nullable ? ["null"] : [])].join(" | ");
};

let ts: typeof TS | undefined;

/** openapi-typescript `transform`: returns a TypeScript node. */
export const openEnums: NonNullable<OpenAPITSOptions["transform"]> = (schema) => {
  const e = extensibleEnum(schema);
  if (!e) return undefined;
  ts ??= createRequire(import.meta.url)("typescript") as typeof TS;
  const f = ts.factory;
  const literals = e.values.map((v) => f.createLiteralTypeNode(f.createStringLiteral(v)));
  const openString = f.createIntersectionTypeNode([f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword), f.createTypeLiteralNode([])]);
  const members: TS.TypeNode[] = [...literals, openString];
  if (e.nullable) members.push(f.createLiteralTypeNode(f.createNull()));
  return f.createUnionTypeNode(members);
};
