import { defineConfig } from "vitest/config";
import { TYPESAFE_STACK } from "./codegen/stacks.ts";

/** Test files that run the runtime (`src/`) and so run once per stack (ADR 0017). */
const RUNTIME_TESTS = ["test/compat.test.ts", "test/loader.test.ts", "test/majors.test.tsx", "test/react.test.tsx", "test/stack.test.ts"];

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
        test: { name: "openapi-typesafe", include: RUNTIME_TESTS, provide: { stack: "openapi-typesafe" } },
      },
    ],
  },
});
