# openapi-versions

## 0.2.0

### Minor Changes

- 4e6a21a: Codegen can generate types with openapi-typesafe as well as openapi-typescript (ADR 0017). New config key `generator` (`"openapi-typescript"` or `"openapi-typesafe"`); when it is left out, the installed one is used, and openapi-typescript if both are. Codegen fails with an install hint when neither is installed. New exports `loadGenerator` and `GENERATORS`. `typescript` is loaded only on the openapi-typescript path, and `openEnums` no longer needs openapi-typescript's types.
  
  Upgrading: openapi-typescript and openapi-typesafe are now optional peer dependencies, so npm no longer installs openapi-typescript for you. If your app relied on that, add it as a dev dependency (`npm i -D openapi-typescript`), as getting-started already says.
- 63d0d6c: Codegen: `generator: "hey-api"` runs `@hey-api/openapi-ts` (0.99.x, experimental, ADR 0027) on each major's merged spec. Its output goes in `v<n>/sdk/`. Extensible enums stay open unions. `meta.ts` gains `opIds` (Hey API operation id → op key). `core.ts` and `gated.ts` split the operation functions into floor operations and operations added after the floor. Hey API is tried last in auto-detection. `loadGenerator()` now returns a `kind` (`"schema"` or `"sdk"`). The runtime entry `openapi-versions/hey-api` that the generated `client.ts` imports ships separately (#126).

### Patch Changes

- b1ef5c8: Build with tsdown instead of tsup. Same entry points, exports and types; internal chunk file names change and Node built-ins are imported with the `node:` prefix.
- 0dcef0e: Codegen replaces each generated file atomically (temp file + rename) and leaves unchanged files untouched, so tsc, vitest or vite reading `outDir` during a regen never see a missing or half-written file. Every file is generated before any is written, so an error while generating leaves the previous output whole. Codegen also removes the `<outDir>/v<n>` dirs it generated for majors no longer in the config.
- 3deac4b: Two codegen runs on the same `outDir` no longer mix their files: the write phase holds a short-lived lock file (`<outDir>/.openapi-versions.lock`), taken over automatically when left by a killed run. Every changed file is also staged before any is renamed, so a disk-full or permission error while writing leaves the previous output whole.
- 2f205e8: Keep the `typescript` dependency on 5.x, inside `openapi-typescript`'s declared peer range, until upstream supports TypeScript 6.
- 4fed700: Name the public return types: `createVersionAware` returns `VersionAware<P, G, F>` (`VersionAwareCore<P, G>` & `ReactBindings<P, G, F>`), `build` returns `MajorReport[]`, `computeSince` returns `SinceResult`, and `mergeAll` returns `Json` instead of `any`. `FeatureProps` is exported. Same shapes as before; `.d.ts` are now emitted by Oxc.
- d77d03e: Codegen: a field that an older supported minor declares nullable (`nullable: true`, `"null"` in `type`, or a nullable reference such as `anyOf: [{$ref}, {type: "null"}]`) stays nullable in the merged types when a newer minor drops it. oasdiff does not flag that change for responses, and a backend still on the older minor can send `null`. The merge also no longer drops a schema property named `required`.
- 6629781: Codegen: a schema whose shape changes between supported minors (inline to `$ref`, a different `$ref` target, `allOf`/`anyOf`/`oneOf` to inline…) is merged as an `anyOf` of both shapes, so the types accept what a backend on any minor sends. This holds behind a null wrapper (`anyOf: [{$ref}, {type: "null"}]`, 3.0 `nullable` + `allOf`) and over any number of minors, and `anyOf`/`oneOf` members are now unioned across minors. The merge used to let the newest shape or member list win, dropping data only an older minor has (such as an enum value a newer `$ref` no longer lists), and mixed the keys of two shapes that had no `$ref`, which generators read as an intersection.
- f356f81: Codegen: an extensible enum marked with OpenAPI 3.0 `nullable: true` now keeps `| null`, as `type: ["string", "null"]` already did, on both the openapi-typescript and the openapi-typesafe path.

## 0.1.0

### Minor Changes

- f6a0af8: Initial release.
