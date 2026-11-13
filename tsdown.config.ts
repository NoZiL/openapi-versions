import { defineConfig } from "tsdown";

/**
 * Runtime (react + core, and the Hey API runtime), codegen API and CLI. dependencies and peerDependencies stay external.
 * `.d.ts` come from Oxc (`isolatedDeclarations`, checked by `tsconfig.build.json`), see ADR 0018.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    core: "src/core/index.ts",
    "hey-api": "src/hey-api/index.tsx",
    codegen: "codegen/index.ts",
    cli: "codegen/cli.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  // package.json "exports" point at .js / .d.ts, not .mjs / .d.mts
  fixedExtension: false,
  tsconfig: "tsconfig.build.json",
  dts: { entry: ["src/index.ts", "src/core/index.ts", "src/hey-api/index.tsx", "codegen/index.ts"], generator: "oxc" },
  clean: true,
  sourcemap: true,
});
