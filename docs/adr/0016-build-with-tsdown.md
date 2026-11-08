# 0016. Build with tsdown; `.d.ts` from TypeScript 5, no dev-only TS 7 yet

- Status: accepted
- Date: 2026-11-08

## Context

`pnpm build` used tsup (esbuild + Rollup): four entries (`index`, `core`, `codegen`, `cli`), ESM only, `node20`, bundled `.d.ts`, dependencies and peers external. tsup is in maintenance mode and its author points to tsdown (Rolldown + Oxc, the engine Vite 8 uses). The `typescript` runtime dependency must stay on 5.x (ADR 0012), but a build tool could use a dev-only TS 7 for `.d.ts`.

Measured on this repo (2026-11-08, median of 5 runs including `npx` startup):

| Tool | Time | Notes |
| --- | --- | --- |
| tsup 9 | 1.57 s | |
| tsdown 0.23.7, `.d.ts` via tsc (TS 5.9) | 0.96 s | same exported symbols per entry, no type errors in the emitted `.d.ts` |
| tsdown 0.23.7, `.d.ts` via `tsgo` (TS 7.1.0-beta, npm alias) | 0.55 s | same `.d.ts` as tsc apart from property order; rejects TS 7.0.x (needs ≥ 7.1 beta); logs "TypeScript Go is experimental" |
| tsdown, `.d.ts` via Oxc (`isolatedDeclarations`) | not run | 9 `isolatedDeclarations` errors in `src/` and `codegen/` (inferred return types, e.g. `createVersionAware`) |

Output with tsdown: same entries, shebang and execute bit on `cli.js`, `typescript`, `semver` and all peers kept external, `.js`/`.d.ts` extensions (with `fixedExtension: false`) so `package.json` `exports` are unchanged. Differences: shared chunks are named after their module (`build-<hash>.js`, `core-<hash>.js`) and the `.d.ts` share a chunk instead of `index.d.ts` importing `core.d.ts`. Node built-ins are imported with the `node:` prefix (fine on Node ≥ 20).

Plain `tsc`/`tsgo` without a bundler was the runner-up. It needs `.js` import paths or `rewriteRelativeImportExtensions`, ships one file per source file, and gains nothing over tsdown here. Other options (unbuild, pkgroll, bunchee, Vite library mode) need more config for the same result.

## Decision

Build with tsdown (`tsdown.config.ts`); drop tsup. `.d.ts` come from the default generator, which uses the TypeScript 5 already installed as our dependency. We do not add a dev-only TypeScript 7 for now: the `tsgo` generator only works with a 7.1 beta, is experimental, and saves about 0.4 s on a build that takes about 1 s.

## Consequences

One build tool on the same engine as the playground (Vite 8 / Rolldown). tsdown is still 0.x, so minor bumps can break the config; Renovate PRs for it need a `pnpm build` look, not just green CI. Revisit the `tsgo` generator when TypeScript 7.1 is stable (a dev-only `typescript-7` alias plus `dts: { generator: "tsgo", tsgo: { moduleUrl: import.meta.resolve("typescript-7") } }`), or when ADR 0012 moves the runtime dependency to TS 7. Adopting `isolatedDeclarations` (explicit return types) would enable the Oxc `.d.ts` path, but that is a source change of its own.
