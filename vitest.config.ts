import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    // *.test.tsx files opt into jsdom with `// @vitest-environment jsdom`.
    coverage: { provider: "v8", include: ["src/**", "codegen/**"], reporter: ["text", "lcov"] },
  },
});
