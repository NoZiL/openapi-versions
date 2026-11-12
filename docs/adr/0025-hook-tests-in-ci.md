# 0025. CI runs the Claude Code hook tests

- Status: accepted
- Date: 2026-11-10

## Context

`.claude/hooks/` has three self-contained test scripts (`stop-check.test.sh`, `guard-generated.test.sh`, `biome-fix.test.sh`), each building a throwaway repo (about 25 s together). They ran by hand only (issue #72), yet `stop-check.test.sh` also asserts the `mise.toml` depends and run lines the Stop hook's cache relies on (ADRs 0015, 0020), so a change to `mise.toml` could break the cache with nothing failing.

## Decision

A mise task, `test:hooks`, runs every `.claude/hooks/*.test.sh` and fails if any fails (it runs them all first, so one failure doesn't hide another). `check` depends on it, and the CI job runs `mise run test:hooks` after `pnpm test`. `check:fast`, which the Stop hook runs, does not: the hooks change rarely, and the Stop hook testing itself on every turn adds time for no gain.

The scripts need `git`, `jq`, `shasum`, `node` and `mise`, which the CI runner has (`jq`, `node` and `mise` through `jdx/mise-action`). They were checked on Ubuntu 24.04 before this change: `sort -z`, `xargs` and `shasum` behave as on macOS.

## Consequences

A hook or `mise.toml` change that breaks a hook test fails CI. New `*.test.sh` scripts in `.claude/hooks/` run with no wiring. CI takes about 25 s more.
