/**
 * The runtime packages of the two generator stacks (ADR 0017). The runtime in `src/` is written
 * against the openapi-typescript stack; the `openapi-versions/typesafe` build, and the tests that
 * run it, resolve each of these to its openapi-typesafe counterpart.
 */
export const TYPESAFE_STACK: Readonly<Record<string, string>> = {
  "openapi-fetch": "openapi-typesafe-fetch",
  "openapi-react-query": "openapi-typesafe-react-query",
  "openapi-typescript-helpers": "openapi-typesafe-helpers",
};
