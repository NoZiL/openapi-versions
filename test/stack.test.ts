/**
 * The runtime tests run once per generator stack (vitest projects, ADR 0017). This checks that
 * each project resolves the stack packages to its own stack, so the second run is not a silent
 * copy. It checks this file's imports: `src/` is never externalized, so its imports go through
 * the same aliases.
 */
import * as fetchClient from "openapi-fetch";
import * as queryClient from "openapi-react-query";
import * as typesafeFetch from "openapi-typesafe-fetch";
import * as typesafeQuery from "openapi-typesafe-react-query";
import { describe, expect, inject, it } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    stack: "openapi-typescript" | "openapi-typesafe";
  }
}

describe("runtime stack", () => {
  const typesafe = inject("stack") === "openapi-typesafe";

  it(`resolves openapi-fetch to the ${inject("stack")} stack`, () => {
    expect((fetchClient.default as unknown) === typesafeFetch.default).toBe(typesafe);
  });

  it(`resolves openapi-react-query to the ${inject("stack")} stack`, () => {
    expect((queryClient.default as unknown) === typesafeQuery.default).toBe(typesafe);
  });
});
