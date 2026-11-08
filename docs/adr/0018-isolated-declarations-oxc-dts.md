# 0018. `.d.ts` from Oxc with `isolatedDeclarations` on the library sources; amends 0016

- Status: accepted
- Date: 2026-11-08

## Context

ADR 0016 kept tsdown's tsc generator for `.d.ts` because `src/` and `codegen/` had `isolatedDeclarations` errors, mostly inferred return types (`createVersionAware`, `createReactBindings`, `createVersionAwareCore`, `build`, `computeSince`, `mergeAll`). The Oxc generator needs code without those errors, but needs no type checker.

Measured on this repo (2026-11-08, `pnpm build`, median of 5 runs):

| `.d.ts` generator | Time |
| --- | --- |
| tsc (TS 5.9) | 0.67 s |
| Oxc (`isolatedDeclarations`) | 0.16 s |

The saving is small in absolute terms. The stronger argument is that the public return types become named, documented types (`VersionAware`, `VersionAwareCore`, `ReactBindings`, `FeatureProps`, `MajorReport`, `SinceResult`) instead of large inferred literals, and that changing them now means editing a type, not changing code that happens to shift an inferred type.

Turning `isolatedDeclarations` on in the root `tsconfig.json` would also flag the tests, the playground and the generated `v<major>/client.ts` / `index.ts`, which come from the codegen template. Making the generated code compatible is a separate change.

## Decision

- Public functions in `src/` and `codegen/` have explicit return types, using the named types above.
- `tsconfig.build.json` extends `tsconfig.json`, includes only `src` and `codegen`, and sets `isolatedDeclarations`. `pnpm typecheck` runs `tsc -p tsconfig.build.json --noEmit`, so a regression fails CI.
- tsdown uses that tsconfig and `dts.generator: "oxc"`.
- The root `tsconfig.json` does not set `isolatedDeclarations`.

The rest of ADR 0016 (tsdown, no dev-only TS 7) stands.

## Consequences

Builds take about 0.16 s. Every new export from `src/` or `codegen/` needs an explicit type where it cannot be inferred locally; `pnpm typecheck` says which. Exported names per entry are the same as with tsc, plus the new named types. If the generated client becomes `isolatedDeclarations`-compatible, the flag can move to the root `tsconfig.json` and `tsconfig.build.json` can go.
