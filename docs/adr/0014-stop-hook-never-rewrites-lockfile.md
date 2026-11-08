# 0014. The Stop hook fails instead of re-syncing the lockfile

- Status: accepted
- Date: 2026-11-08

## Context

Amends [0013](0013-stop-hook-adr-and-check.md). When `package.json` dependencies differ from `pnpm-lock.yaml`, pnpm re-syncs the lockfile and `node_modules` before running any script (`verify-deps-before-run`). `mise run check:fast` calls `pnpm lint`, `pnpm typecheck` and `pnpm test`, so the hook rewrote `pnpm-lock.yaml` as a side effect (issue #56). The agent then saw a lockfile diff it did not make, and the hook's cache key no longer matched the tree.

## Decision

The hook runs `check:fast` with `pnpm_config_verify_deps_before_run=error`. If dependencies and lockfile disagree, pnpm exits with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` ("run pnpm install") and the hook blocks with that output. The hook never modifies the working tree. We chose failing over `false` because `false` would run the checks against stale `node_modules` and report a misleading green.

## Consequences

A session that edits dependencies must run `pnpm install` itself before finishing. The setting applies to the hook only; developers and CI keep pnpm's defaults.
