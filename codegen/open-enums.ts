/**
 * openapi-typescript `transform` hook for EXTENSIBLE enums.
 *
 * The backend declares enums that may grow within a major with `x-extensible-enum`
 * (plain `enum` stays closed: adding a value to it is a breaking change, and oasdiff
 * flags it). Extensible enums become OPEN unions:
 *   "active" | "invited" | (string & {})
 * Autocomplete still lists the known values, a value added by a newer backend
 * compiles, and `switch` statements need a `default` branch.
 */

import type { OpenAPITSOptions } from "openapi-typescript";
import ts from "typescript";

const f = ts.factory;

export const openEnums: NonNullable<OpenAPITSOptions["transform"]> = (schema) => {
  const s = schema as any;
  const isString = s.type === "string" || (Array.isArray(s.type) && s.type.includes("string"));
  const values = s["x-extensible-enum"];
  if (!isString || !Array.isArray(values) || !values.every((v: unknown) => typeof v === "string")) return undefined;

  const literals = (values as string[]).map((v) => f.createLiteralTypeNode(f.createStringLiteral(v)));
  const openString = f.createIntersectionTypeNode([f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword), f.createTypeLiteralNode([])]);
  const members: ts.TypeNode[] = [...literals, openString];
  if (Array.isArray(s.type) && s.type.includes("null")) members.push(f.createLiteralTypeNode(f.createNull()));
  return f.createUnionTypeNode(members);
};
