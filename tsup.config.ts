import { defineConfig } from "tsup";

/** Runtime (react + core), codegen API and CLI. dependencies and peerDependencies stay external. */
export default defineConfig({
  entry: { index: "src/index.ts", core: "src/core/index.ts", codegen: "codegen/index.ts", cli: "codegen/cli.ts" },
  outDir: "dist",
  format: ["esm"],
  target: "node20",
  dts: { entry: { index: "src/index.ts", core: "src/core/index.ts", codegen: "codegen/index.ts" } },
  clean: true,
  sourcemap: true,
  external: ["react", "react-dom"],
});
