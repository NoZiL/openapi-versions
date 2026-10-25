---
name: openapi-versions-setup
description: Set up the version-aware API client (multi-minor OpenAPI codegen on top of openapi-typescript) in an app, or verify an existing setup. Use when the user wants one client to work against a range of backend minor versions, mentions openapi-versions.config.json, specs/<semver>.json, floor, gating, or X-Api-Version.
---

# Set up the version-aware client

Read `docs/concepts.md` once if the vocabulary (major, minor, floor, gated) is unclear. Reference: `docs/reference.md`.

## Checklist

1. **oasdiff**: `command -v oasdiff` (else `brew install oasdiff` or set `OASDIFF_BIN`). Without it codegen warns and skips the gate; set `"gate": "required"` (or pass `--require-gate`) in CI.
2. **Specs**: `specs/<semver>.json`, one per released version of ONE major, from the backend release artifacts. Ask the user where to get them if absent; never invent specs.
3. **Config** `openapi-versions.config.json`:
   ```json
   { "$schema": "./openapi-versions.schema.json", "specsDir": "specs", "outDir": "src/generated", "majors": { "1": { "floor": "1.3.0" } } }
   ```
   The floor is the oldest minor the app supports and must have its own spec file. Ask the user for the floor if unknown (default suggestion: the oldest minor running in any environment: prod, staging, on-prem).
4. **Generate**: `npx openapi-versions` (or an npm script). Expect `ok v1: a -> b` lines then `gen v1: …`.
5. **Install**: `npm i openapi-versions openapi-fetch openapi-react-query @tanstack/react-query` and `npm i -D openapi-typescript "typescript@<7"`; apply the `openapi-typescript-helpers` patch from `patches/` (patch-package).
   Import everything from the generated `<outDir>/v<n>/client.ts` (`ApiVersionProvider`, `useApi`, `Feature`, `createApi`, `Paths`); the major appears only in that import path.
6. **Provider**: wrap the app in `QueryClientProvider` then `<ApiVersionProvider baseUrl="https://host/api/v<n>">`. The base URL must include the major prefix; `/version` is read relative to it.
7. **Verify**: `pnpm typecheck && npm test`; for a visual check `pnpm playground`.

## Backend prerequisites (confirm, do not assume)

`GET <prefix>/version` → `{"version":"<real semver>"}`; `X-Api-Version` on every response; additive changes only within a major; growable enums marked `x-extensible-enum`.

## Do not

- Edit `src/generated/**`.
- Add a version comparison in a component.
- Point one app build at two majors.

If codegen fails, read `docs/troubleshooting.md` for the exact message before changing anything.
