# 0026. CI runs `mise run check`, the only list of checks

- Status: accepted
- Date: 2026-11-12
- Amends: [0025](0025-hook-tests-in-ci.md) (the CI job runs `mise run test:hooks` as its own step)

## Context

What "everything CI runs" means was written by hand in four places: the steps in `.github/workflows/ci.yml`, the `depends` of `[tasks.check]` in `mise.toml`, `CONTRIBUTING.md` and the PR template. Nothing checked that they agreed. The PR for #72 updated two of them and missed the other two, which review caught (#129).

Running the checks as separate CI steps also meant a failing step stopped the job, so a red `pnpm test` hid the result of every later check.

## Decision

The CI job installs the tools (`jdx/mise-action`) and dependencies (`pnpm install --frozen-lockfile`), then runs one step: `mise run --continue-on-error check`. `[tasks.check]` is the only list of checks. A new check is a mise task added to its `depends`, with no workflow edit. `CONTRIBUTING.md` and the PR template point to `mise run check` and no longer list the checks.

- mise runs the checks in parallel, with each codegen once as a shared dependency (ADR 0020). That was already how `mise run check` ran locally. CI now runs the same commands as a local `mise run check`.
- `--continue-on-error` runs every check even if one fails, and the step still fails. The flag must come before the task name: after it (`mise run check --continue-on-error`) mise passes it to the task as an argument, and the first failure cancels the other checks. That replaces a separate job for the hook tests, which #129 considered: they no longer wait behind or get skipped by other checks.
- Output is prefixed with the task name (`[test]`, `[test:hooks]`). Telling which check failed means reading the log instead of the step list.
- `pnpm install` stays a separate step because `mise run install` does not use `--frozen-lockfile`.

## Consequences

Adding a check edits one file. CI and local `mise run check` cannot drift. The job is shorter because the checks run in parallel. A CI failure shows as one red step, so finding the failing check needs the log (grep for the task prefix). Revisit if the job grows long enough that separate jobs, each running `mise run <task>`, are worth the extra installs.
