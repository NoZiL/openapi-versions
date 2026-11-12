/**
 * The runtime tests run once per generator stack (vitest projects, ADR 0017). This checks that
 * each project really runs the runtime on its own stack, so the second run is not a silent copy.
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
