# Agent guide: version-aware API client

One client build must work against a range of minor versions of one API major. Codegen merges specs; the runtime hides what the connected backend lacks. Full docs: `docs/README.md`.

## Commands
Tooling: `mise install` (node, pnpm, oasdiff from `mise.toml`), then `pnpm install`. `pnpm lint` (biome), `pnpm changeset` for any change to the published package.

- Package `openapi-versions`: runtime (`openapi-versions`, `/core`), codegen (`/codegen`), CLI (`npx openapi-versions`)
- `pnpm codegen` regenerate `playground/generated` and `test/fixtures/generated` (both gitignored) from their `specs/` + `openapi-versions.config.json`
- `pnpm check:breaking` only the oasdiff gate
- `pnpm typecheck`, `npm test`, `pnpm build` (bundle CLI/API to `dist/`), `pnpm playground` (app), `pnpm playground:api` (CLI demo)

## Rules (do not violate)

1. Never edit `playground/generated/**` or `test/fixtures/generated/**`; change specs/config and re-run codegen.
2. Never hand-edit a spec to make the breaking-change gate pass. Fix the backend, mark the enum `x-extensible-enum`, or move to a new major.
3. Calls to operations added after the floor go through `$gated` + `gate()` (queries) or `<Feature>` (mutations). Never compare version numbers in components; ask `useSupports` / `useHasField`.
4. `switch` over an extensible enum needs a `default` branch.
5. Spec files are named exactly `<semver>.json`. The floor needs its own spec file.
6. Import hooks/components from the generated `v<n>/client.ts`, never from the runtime package directly. `baseUrl` includes the major (`https://host/api/v1`). One app release supports one major.
7. Keep the `patches/` fix applied (`pnpm` `patchedDependencies`); without it open enums collapse to `string`. Drop it once openapi-typescript-helpers ships openapi-ts/openapi-typescript#2766.

## Open work and decisions
Todos are GitHub Issues (labels in `.github/labels.yml`, `blocked-upstream` for items waiting on openapi-ts). Decisions are ADRs in `docs/adr/` (accepted ones are immutable; supersede, don't edit). Check both before starting; add an ADR when you change a design decision.

## Skills

`skills/openapi-versions-setup`, `skills/openapi-versions-add-spec`, `skills/openapi-versions-gate-feature` (also exposed to Claude Code via `.claude/skills`).
