# 0015. The Stop hook's cache key covers what the checks read, as they saw it

- Status: accepted
- Date: 2026-11-08

## Context

Amends [0013](0013-stop-hook-adr-and-check.md). The green-run cache hashed `HEAD`, `git diff HEAD` and the untracked files, and was computed before `check:fast` started (issue #58). Two gaps:

- Gitignored inputs were not in the key. Reproduced: after a green run, moving `node_modules` away left the hash unchanged, so the hook skipped while `check:fast` failed. Deleting `playground/generated` was also skipped; that is harmless today because `typecheck` and `test` delete and regenerate both generated dirs, but it holds only as long as those scripts do.
- A change made while the checks ran (another tool, a second session in the same worktree) was recorded under the state hashed before the run, so the checks never saw that exact state.

## Decision

The key also hashes the contents of `playground/generated`, `test/fixtures/generated`, `node_modules/.modules.yaml` and `node_modules/.pnpm/lock.yaml`: pnpm records what it installed in the last two, so an install that changes `node_modules` changes the key and a no-op install does not. Codegen is deterministic, so regenerating the same output keeps the key. The hook hashes the state again after a green run and writes the cache only if it equals the state before the run, via a temp file and `mv`. A missing or vanishing file makes the hash fail, and a failed hash never hits or writes.

The cache stays one file per worktree. Concurrent sessions can overwrite each other's entry, which costs a re-run but never a wrong skip, since every entry was verified before and after its run.

`.claude/hooks/stop-check.test.sh` covers hit, misses on generated and `node_modules` changes, changes during the run and red runs, with `check:fast` stubbed through `STOP_CHECK_CMD`.

## Consequences

The checks re-run after an install that changes `node_modules` or a codegen change, and after a run that regenerated a deleted dir (one extra run). Hand edits to package files inside `node_modules` are still not in the key; reinstall or edit a tracked file to force a run. The hook tests are run by hand, not in CI.
