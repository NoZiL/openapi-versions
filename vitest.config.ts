import { defineConfig } from "vitest/config";
import { TYPESAFE_STACK } from "./codegen/stacks.ts";

/** Tests that do not run the runtime (`src/`): run once. Every other test runs once per stack (ADR 0017). */
const CODEGEN_TESTS = ["test/codegen.test.ts", "test/codegen-lock.test.ts", "test/generator.test.ts"];

export default defineConfig({
  test: {
    // *.test.tsx files opt into jsdom with `// @vitest-environment jsdom`.
    coverage: { provider: "v8", include: ["src/**", "codegen/**"], reporter: ["text", "lcov"] },
    projects: [
      {
        extends: true,
        test: { name: "openapi-typescript", include: ["test/**/*.test.{ts,tsx}"], provide: { stack: "openapi-typescript" } },
      },
      {
        // the runtime against the openapi-typesafe stack, as `openapi-versions/typesafe` is built
        extends: true,
        resolve: { alias: Object.entries(TYPESAFE_STACK).map(([find, replacement]) => ({ find, replacement })) },
        test: {
          name: "openapi-typesafe",
          include: ["test/**/*.test.{ts,tsx}"],
          exclude: CODEGEN_TESTS,
          provide: { stack: "openapi-typesafe" },
        },
      },
    ],
  },
});
