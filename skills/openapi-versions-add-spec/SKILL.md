---
name: openapi-versions-add-spec
description: Add a new backend release spec, raise the floor, fix a breaking-change failure, or move the app to the next API major in the version-aware client. Use when the backend ships a new minor, when `pnpm codegen` fails with `FAIL v1: a -> b` or an oasdiff report, or when a version leaves the support window.
---

# Add a spec, raise the floor, handle breaks

Details and rationale: `docs/how-to.md`.

## A new backend release (minor)

1. Save the release's spec as `specs/<exact semver>.json` (from the backend CI artifact, not a branch tip). It may be unreleased: its features stay hidden until the backend reports that version.
2. `pnpm codegen`.
3. `git diff src/generated/v1/meta.ts`: new keys in `gatedOps` / `gatedFields` are what the app can now gate. Report them to the user.
4. If the spec changed again before release, overwrite the file and re-run.

## Codegen fails with `FAIL v1: X -> Y`

The pair is not additive (removed/renamed/retyped, new required request field, or value added to a closed `enum`). In order:
1. Tell the user the backend change must be made additive. Quote the oasdiff report.
2. If the report is `response-property-enum-value-added` and the enum is meant to grow: the backend declares it `x-extensible-enum`.
3. If the break is intended: it needs a new major (below).
NEVER edit a spec to silence the gate, never delete the offending spec, never bypass `checkChain`.

## Raise the floor

1. Set `majors.<n>.floor` in `openapi-versions.config.json` (a spec file with that exact version must exist).
2. `pnpm codegen`, then `pnpm typecheck`.
3. Operations now at-or-below the floor are ungated: remove `useSupports`/`<Feature requires>`/`gate()` that the compiler flags or that guard operations no longer in `gatedOps`.

## Next major

Backend serves `/api/vN+1` side by side with the frozen `/api/vN` (with `Sunset`). In the app: set `majors` to `{ "<N+1>": { "floor": "<N+1>.0.0" } }`, add the new specs, change imports from `…/v<N>/client` to `…/v<N+1>/client`, point `baseUrl` at `/api/v<N+1>`, run codegen, fix compile errors. This is a new app release; the app never switches majors at runtime.

## Verify

`pnpm codegen && pnpm typecheck && npm test`. Report what changed in `meta.ts`.
