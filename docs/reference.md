# Reference

## Config

File: `openapi-versions.config.json`. JSON Schema: [`openapi-versions.schema.json`](../openapi-versions.schema.json); add `"$schema": "./openapi-versions.schema.json"` for editor autocompletion. The CLI also validates it and reports what to fix.

| Key                | Type                                          | Meaning                                                                                                                                                                        |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `specsDir`         | string                                        | Folder of `<semver>.json` specs. Other file names are ignored.                                                                                                                 |
| `outDir`           | string                                        | Generated output folder. Safe to delete and regenerate.                                                                                                                        |
| `majors`           | object                                        | Keyed by major number (`"1"`). Normally one entry per app release.                                                                                                             |
| `majors.<n>.floor` | plain semver                                  | Oldest supported minor of major `n`. Must be in major `n` and must have a spec file.                                                                                           |
| `gate`             | `"auto"` \| `"required"` \| `"off"`, optional | Breaking-change gate. `auto` (default): run oasdiff if installed, otherwise warn and skip. `required`: fail when oasdiff is missing or older than 1.34.0. `off`: never run it. |
| `runtimeImport`    | string, optional                              | Module the generated `client.ts` imports the runtime from. Default `openapi-versions`. A relative path when developing the runtime in the same repo.                           |

## CLI

```
openapi-versions [--config <path>] [--check-only] [--require-gate]
```

| Flag             | Effect                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `--config`       | Config path. Default `openapi-versions.config.json`.                                                            |
| `--check-only`   | Run only the oasdiff gate; write nothing. Fails if oasdiff is missing.                                          |
| `--require-gate` | Fail when oasdiff is missing or too old, instead of skipping the gate. Same as `"gate": "required"`. Use in CI. |

Exit code 1 on: invalid config, missing floor spec, any breaking pair, and (with `--require-gate`, `"gate": "required"` or `--check-only`) a missing or too-old oasdiff (minimum 1.34.0). Environment: `OASDIFF_BIN` overrides the oasdiff binary.

## Package entry points

| Import                         | Content                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `openapi-versions`             | Runtime: `createVersionAware(meta)` (core + React), plus the core exports                                                      |
| `openapi-versions/core`        | Framework-free runtime: `resolveCompat`, `createApi`, `createApiClient`, `fetchBackendVersion`, `createVersionAwareCore(meta)` |
| `openapi-versions/codegen`     | Programmatic codegen API                                                                                                       |
| `openapi-versions/schema.json` | JSON Schema of the config                                                                                                      |
| `npx openapi-versions`         | The CLI                                                                                                                        |

Apps rarely call `createVersionAware` themselves: the generated `client.ts` does, with the app's types. Peers: `openapi-typescript`, `openapi-fetch`, and optionally `openapi-react-query`, `@tanstack/react-query`, `react`.

In this repo: `pnpm codegen`, `pnpm check:breaking`, `pnpm build` (bundles with tsup into `dist/`).

## Programmatic API

```ts
import { build, loadConfig, mergeAll, computeSince, checkChain, openEnums, BreakingChangeError } from "openapi-versions/codegen";

const report = await build(loadConfig("openapi-versions.config.json"), { checkOnly: false, log: console.log });
```

| Export                                     | Purpose                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `build(config, { checkOnly?, log? })`      | Whole pipeline. Throws `BreakingChangeError` (with `.report`) if a pair is breaking. |
| `loadConfig(path)` / `validateConfig(obj)` | Read and validate config.                                                            |
| `mergeAll(docs)` / `mergeTolerant(a, b)`   | Tolerant merge of OpenAPI documents.                                                 |
| `computeSince(docs, floor)`                | `{ ops, gatedOps, gatedFields }`                                                     |
| `checkChain(files)` / `checkPair(a, b)`    | oasdiff gate.                                                                        |
| `openEnums`                                | openapi-typescript `transform` hook for `x-extensible-enum`.                         |

## Pipeline, per major

1. Select specs with the same major and version `>=` floor. The floor spec must exist.
2. `oasdiff breaking <prev> <next> --fail-on ERR` for each consecutive pair.
3. Tolerant merge (rules below). `info.version` of the merged doc becomes `"<floor> - <newest>"`.
4. Since maps.
5. `openapi-typescript` on the merged doc with the `openEnums` transform.

## Merge rules

| Element                                   | Rule                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| paths, operations, properties, parameters | union                                                     |
| `required` array on a schema              | intersection (required only if every version requires it) |
| `required` boolean on a parameter or body | AND                                                       |
| parameter present in only some versions   | never required (path params stay required)                |
| `enum`, primitive arrays                  | union of values, order kept                               |
| everything else (descriptions, formats …) | newest wins                                               |

The inputs must be non-breaking relative to each other (step 2); otherwise the union can describe a shape no server ever had.

## Since maps

- `gatedOps`: `"<method> <path>" → first version that has it`, only for versions above the floor.
- `gatedFields`: `"<Schema>.<property>" → first version`, only for properties added to a schema that already existed in an earlier version (fields born with their schema are covered by the operation that returns it).
- `ops`: every operation key in the merged contract.

## Generated files

| File                                | Content                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<outDir>/v<n>/schema.d.ts`         | openapi-typescript types of the merged contract; extensible enums are open unions                                                                                                 |
| `<outDir>/v<n>/meta.ts`             | `meta = { major, floor, newest, specs, ops, gatedOps, gatedFields }` plus `Op`, `GatedOp`, `GatedField` types                                                                     |
| `<outDir>/v<n>/merged.openapi.json` | the merged document (useful to inspect or diff)                                                                                                                                   |
| `<outDir>/v<n>/client.ts`           | the runtime bound to this major: `ApiVersionProvider`, `useApi`, `useSupports`, `useHasField`, `useSunset`, `Feature`, `createApi`, types `Paths`, `GatedOp`, `GatedField`, `Api` |
| `<outDir>/index.ts`                 | `majors`, `SupportedMajor`, and `PathsV<n>`, `GatedOpV<n>`, `GatedFieldV<n>` aliases                                                                                              |

## Runtime API

Exported from the generated `client.ts` (bound to your types) and, unbound, from `openapi-versions` / `openapi-versions/core`:

| Symbol                                                                                    | Meaning                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveCompat(version, majors, { prereleaseAsRelease? })`                                | Returns `{ status: "ok", version, major, backendAhead, supports(op), hasField(field) }` or `{ status: "backend-too-old", floor }`, `{ status: "app-too-old", supportedMajors }`, `{ status: "invalid-version" }` |
| `createApi({ baseUrl, fetch?, prereleaseAsRelease? })` (unbound: `createApi(meta, opts)`) | Reads `<baseUrl>/version`, returns `Api`; throws if not `ok`                                                                                                                                                     |
| `Api`                                                                                     | `{ compat, client: { core, gated }, $api, $gated, gate() }`                                                                                                                                                      |
| `$api`                                                                                    | openapi-react-query client typed **without** gated operations                                                                                                                                                    |
| `$gated`                                                                                  | `{ queryOptions, useMutation }` typed with everything                                                                                                                                                            |
| `gate(options)`                                                                           | Replaces `queryFn` with `skipToken` when the backend lacks the operation                                                                                                                                         |
| `createApiClient({ baseUrl, fetch?, onVersionHeader?, onSunsetHeader? })`                 | The single openapi-fetch client; middleware reads `X-Api-Version` and `Sunset`                                                                                                                                   |

React part:

| Symbol                                                                             | Meaning                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<ApiVersionProvider baseUrl fetch? loading? renderBlocked? prereleaseAsRelease?>` | Fetches `/version` (React Query key `["api-version"]`, stale 5 min, refetch on focus), renders `renderBlocked(compat)` when not `ok`, re-evaluates when `X-Api-Version` changes |
| `useApi()`                                                                         | The `Api` object; throws outside the provider                                                                                                                                   |
| `useSupports(op)` / `useHasField(field)`                                           | Booleans                                                                                                                                                                        |
| `<Feature requires fallback?>`                                                     | Renders children only if the operation is supported                                                                                                                             |
| `useSunset()`                                                                      | `Date                                                                                                                                                                           | undefined`from the`Sunset` header |

## Backend contract

- Additive changes only inside a major (oasdiff gate).
- Growable enums declared `x-extensible-enum`.
- Each major under its own prefix; `GET <prefix>/version` → `{ "version": "<semver>" }`; `X-Api-Version` on every response; real semver.
- `/api/v1/version` reports the version of the v1 **contract**, not of the deployment; after v2 ships, v1 is frozen (patch versions only).
- A major being retired sends `Sunset: <HTTP-date>` (RFC 8594) on all its responses.
- Each release publishes its spec as a CI artifact from the release commit.
