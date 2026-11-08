# 0019. The openapi-typesafe open-enum transform returns an IR node, not type text

- Status: accepted
- Date: 2026-11-08
- Amends: [0017](0017-support-openapi-typescript-and-openapi-typesafe.md) (the openapi-typesafe codegen path and the parity test)

## Context

ADR 0017 says that on the openapi-typesafe path, `codegen/open-enums.ts` uses `irCallbacks` and returns type text. While building #68, the review found that openapi-typesafe prints type text exactly as written, without parentheses. An extensible enum inside an array came out as `"a" | "b" | (string & {})[]`, so a single value type-checked where an array was expected. The same thing happened inside `allOf` (`... & unknown`) and with nullable array items. openapi-typescript builds a TypeScript node, and its printer adds the parentheses.

ADR 0017 also says that the two `schema.d.ts` differ only in the header line. Beyond that, the two printers escape non-ASCII string literals differently: openapi-typescript writes `"café"` and openapi-typesafe writes `"café"`. Both are the same type.

## Decision

- On the openapi-typesafe path, the transform still uses `irCallbacks: true` and still needs no `typescript`, but it returns an IR union built with openapi-typesafe's helpers (`tsUnion`, `tsIntersection`, `tsLiteral`, `STRING`, `NULL`), not text. The printer then adds parentheses where they are needed. No public helper builds the empty object type `{}`, so the transform writes that one node by hand (`{ kind: "object", members: [] }`).
- The parity test compares the two outputs after removing the header and decoding `\uXXXX` escapes. A fixture (`test/fixtures/enum-shapes`) covers enums inside arrays, `allOf` and nullable `anyOf`, nullable enums, and values that need escaping.

## Consequences

- Both paths produce the same types, including nested enums.
- We depend on one IR node shape (the empty object) that openapi-typesafe does not build through a public helper. If a 1.x release changes that shape, the parity test fails. Revisit if openapi-typesafe adds a helper for `{}`, or offer one upstream (#75).
