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
 * - openapi-typescript: `openEnums` returns a `ts.factory` node, built with the `typescript` that openapi-typescript loads.
 * - openapi-typesafe: `openEnumsIr` (with `irCallbacks: true`) returns an IR union built with its helpers; no `typescript` needed.
 *   An IR node, not type text: the printer adds the parentheses a union needs inside an array or intersection.
 *
 * Each stack is loaded on first use only, so an app needs only the one it picks.
 */

import { createRequire } from "node:module";
import type * as TS from "typescript";

const require = createRequire(import.meta.url);

/** The known values of an extensible string enum, or undefined if the schema is not one. */
function extensibleEnum(schema: unknown): { values: string[]; nullable: boolean } | undefined {
  const s = schema as { type?: unknown; "x-extensible-enum"?: unknown };
  const isString = s.type === "string" || (Array.isArray(s.type) && s.type.includes("string"));
  const values = s["x-extensible-enum"];
  if (!isString || !Array.isArray(values) || !values.every((v: unknown) => typeof v === "string")) return undefined;
  return { values, nullable: Array.isArray(s.type) && s.type.includes("null") };
}

let ts: typeof TS | undefined;

/** openapi-typescript `transform`: returns a TypeScript node. */
export const openEnums = (schema: unknown, _options?: unknown): TS.TypeNode | undefined => {
  const e = extensibleEnum(schema);
  if (!e) return undefined;
  // the same typescript openapi-typescript prints with, not necessarily ours
  ts ??= createRequire(require.resolve("openapi-typescript"))("typescript") as typeof TS;
  const f = ts.factory;
  const literals = e.values.map((v) => f.createLiteralTypeNode(f.createStringLiteral(v)));
  const openString = f.createIntersectionTypeNode([f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword), f.createTypeLiteralNode([])]);
  const members: TS.TypeNode[] = [...literals, openString];
  if (e.nullable) members.push(f.createLiteralTypeNode(f.createNull()));
  return f.createUnionTypeNode(members);
};

// inline `import()` types, not an `import type` statement: the bundled .d.ts must not import an optional peer
type Typesafe = typeof import("openapi-typesafe");
type IrType = ReturnType<Typesafe["tsUnion"]>;
let typesafe: Typesafe | undefined;

/** openapi-typesafe `transform` with `irCallbacks: true`: returns an IR type. Internal: not exported from the package. */
export const openEnumsIr = (schema: unknown): IrType | undefined => {
  const e = extensibleEnum(schema);
  if (!e) return undefined;
  typesafe ??= require("openapi-typesafe") as Typesafe;
  const { tsUnion, tsIntersection, tsLiteral, STRING, NULL } = typesafe;
  const emptyObject: IrType = { kind: "object", members: [] };
  return tsUnion([...e.values.map((v) => tsLiteral(v)), tsIntersection([STRING, emptyObject]), ...(e.nullable ? [NULL] : [])]);
};
