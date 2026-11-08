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
  const s = schema as { type?: unknown; nullable?: unknown; "x-extensible-enum"?: unknown };
  const isString = s.type === "string" || (Array.isArray(s.type) && s.type.includes("string"));
  const values = s["x-extensible-enum"];
  if (!isString || !Array.isArray(values) || !values.every((v: unknown) => typeof v === "string")) return undefined;
  // OpenAPI 3.1 `type: ["string", "null"]`, or OpenAPI 3.0 `nullable: true`. For 3.0, both generators add their own
  // `| null` around the result in nested positions (array items, allOf/anyOf members) but not where the result replaces
  // a property or component type, and the hook cannot tell those calls apart; so nested positions get a redundant
  // `(... | null) | null`, the same type.
  return { values, nullable: (Array.isArray(s.type) && s.type.includes("null")) || s.nullable === true };
}

let ts: typeof TS | undefined;

/** The typescript openapi-typescript prints with when it can be found from here, otherwise our own. */
function loadTypescript(): typeof TS {
  try {
    return createRequire(require.resolve("openapi-typescript"))("typescript") as typeof TS;
  } catch {
    return require("typescript") as typeof TS;
  }
}

/** openapi-typescript `transform`: returns a TypeScript node. */
export const openEnums = (schema: unknown, _options?: unknown): TS.TypeNode | undefined => {
  const e = extensibleEnum(schema);
  if (!e) return undefined;
  ts ??= loadTypescript();
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

/**
 * openapi-typesafe `transform` with `irCallbacks: true`, built from the module the generator already imported
 * (one module instance, not an ESM and a CJS copy). Internal: not exported from the package.
 */
export const openEnumsIr =
  ({ tsUnion, tsIntersection, tsLiteral, STRING, NULL }: Typesafe) =>
  (schema: unknown): IrType | undefined => {
    const e = extensibleEnum(schema);
    if (!e) return undefined;
    // no public helper builds `{}`; the parity test fails if this shape stops printing as `{}`
    const emptyObject: IrType = { kind: "object", members: [] };
    return tsUnion([...e.values.map((v) => tsLiteral(v)), tsIntersection([STRING, emptyObject]), ...(e.nullable ? [NULL] : [])]);
  };
