# Agent guide: version-aware API client

One client build must work against a range of minor versions of one API major. Codegen merges specs; the runtime hides what the connected backend lacks. Full docs: `docs/README.md`.

## Commands
Tooling: `mise install` (node, pnpm, oasdiff, actionlint from `mise.toml`), then `pnpm install`. `pnpm lint` (biome), `pnpm changeset` for any change to the published package.

- Package `openapi-versions`: runtime (`openapi-versions`, `/core`), codegen (`/codegen`), CLI (`npx openapi-versions`)
- Stacked PRs (optional, dependent changes): `gh extension install github/gh-stack`, then `gh stack init|add|submit|sync`; merge with `gh stack merge --squash` (repo is squash-only). See ADR 0010.
- `pnpm codegen` regenerate `playground/generated` and `test/fixtures/generated` (both gitignored) from their `specs/` + `openapi-versions.config.json`
- `pnpm check:breaking` only the oasdiff gate
- `pnpm typecheck`, `pnpm test`, `pnpm build` (bundle CLI/API to `dist/`), `pnpm playground` (app), `pnpm playground:api` (CLI demo)

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

## Session scope
One issue per session and per PR. Do what the issue asks; log out-of-scope findings as new issues instead of fixing them in place. Plan first for anything non-trivial. Delegate broad searches to subagents. After opening a PR, or when context gets heavy, run `/wrap-up` (handoff note in the issue) and start a fresh session. The project status line shows context usage, and a hook flags the session at 70% context or 5 commits ahead of `main`.

Before opening a PR that changes code or tooling, get an independent review: `git fetch`, then run `/code-review high origin/main...HEAD` (the whole PR range, not one commit; use the base branch instead of `origin/main` for a stacked PR). Docs-only PRs can skip it. Also check the issue's "done when" list, run what the PR claims to have tested, and tick the PR template honestly (an ADR if a design decision changed). Fix what the review finds and re-run at most once more, then hand the rest to the human. Merging stays human-gated.

## Skills

`skills/openapi-versions-setup`, `skills/openapi-versions-add-spec`, `skills/openapi-versions-gate-feature` (also exposed to Claude Code via `.claude/skills`).
