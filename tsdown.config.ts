import { defineConfig } from "tsdown";

/**
 * Runtime (react + core), codegen API and CLI. dependencies and peerDependencies stay external.
 * `.d.ts` come from TypeScript 5 (the `typescript` dependency), see ADR 0016.
 */
export default defineConfig({
  entry: { index: "src/index.ts", core: "src/core/index.ts", codegen: "codegen/index.ts", cli: "codegen/cli.ts" },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  // package.json "exports" point at .js / .d.ts, not .mjs / .d.mts
  fixedExtension: false,
  dts: { entry: ["src/index.ts", "src/core/index.ts", "codegen/index.ts"] },
  clean: true,
  sourcemap: true,
});
