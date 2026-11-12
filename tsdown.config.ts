import { defineConfig, type UserConfig } from "tsdown";
import { TYPESAFE_STACK } from "./codegen/stacks.ts";

/**
 * Runtime (react + core), codegen API and CLI. dependencies and peerDependencies stay external.
 * `.d.ts` come from Oxc (`isolatedDeclarations`, checked by `tsconfig.build.json`), see ADR 0018.
 *
 * The runtime is built twice (ADR 0017): `dist/` against the openapi-typescript stack and
 * `dist/typesafe/` against the openapi-typesafe stack. The second build renames each stack
 * package's import to its openapi-typesafe counterpart (`output.paths`), in the `.js` and the `.d.ts`;
 * both stay external.
 */
const OPENAPI_TYPESCRIPT_STACK = Object.keys(TYPESAFE_STACK);
const OPENAPI_TYPESAFE_STACK = Object.values(TYPESAFE_STACK);

/** Fails the build when an output file (`.js` or `.d.ts`) imports a package of the other stack. */
const onlyStack = (forbidden: string[]): UserConfig["hooks"] => ({
  "build:done": ({ chunks, options }) => {
    const files = chunks.filter((c) => c.type === "chunk");
    if (!files.some((c) => c.fileName.endsWith(".d.ts"))) throw new Error(`${options.outDir}: no .d.ts was checked`);
    for (const c of files) {
      const bad = [...c.imports, ...c.dynamicImports].filter((i) => forbidden.includes(i));
      if (bad.length) throw new Error(`${options.outDir}/${c.fileName} imports ${bad.join(", ")} from the other stack (ADR 0017)`);
    }
  },
});

const shared: UserConfig = {
  format: "esm",
  platform: "node",
  target: "node20",
  // package.json "exports" point at .js / .d.ts, not .mjs / .d.mts
  fixedExtension: false,
  tsconfig: "tsconfig.build.json",
  sourcemap: true,
};

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts", core: "src/core/index.ts", codegen: "codegen/index.ts", cli: "codegen/cli.ts" },
    outDir: "dist",
    dts: { entry: ["src/index.ts", "src/core/index.ts", "codegen/index.ts"], generator: "oxc" },
    // removes dist/typesafe too; the two builds run in order, this one first
    clean: true,
    hooks: onlyStack(OPENAPI_TYPESAFE_STACK),
  },
  {
    ...shared,
    entry: { index: "src/index.ts", core: "src/core/index.ts" },
    outDir: "dist/typesafe",
    dts: { generator: "oxc" },
    clean: false,
    outputOptions: { paths: { ...TYPESAFE_STACK } },
    hooks: onlyStack(OPENAPI_TYPESCRIPT_STACK),
  },
]);
