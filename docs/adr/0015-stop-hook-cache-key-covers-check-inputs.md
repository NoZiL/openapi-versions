# 0015. The Stop hook's cache key covers what the checks read, as they saw it

- Status: accepted
- Date: 2026-11-08

## Context

Amends [0013](0013-stop-hook-adr-and-check.md). The green-run cache hashed `HEAD`, `git diff HEAD` and the untracked files, and was computed before `check:fast` started (issue #58). Two gaps:

- Gitignored inputs were not in the key. Reproduced: after a green run, moving `node_modules` away left the hash unchanged, so the hook skipped while `check:fast` failed. Deleting `playground/generated` was also skipped; that is harmless today because `typecheck` and `test` delete and regenerate both generated dirs, but it holds only as long as those scripts do.
- A change made while the checks ran (another tool, a second session in the same worktree) was recorded under the state hashed before the run, so the checks never saw that exact state.

## Decision

The key also hashes the contents of `playground/generated`, `test/fixtures/generated`, and `node_modules/.pnpm/lock.yaml`, pnpm's record of what it installed: an install that changes `node_modules` changes the key and a no-op install does not. `node_modules/.modules.yaml` is left out because it carries a `prunedAt` timestamp. Codegen is deterministic, so regenerating the same output keeps the key. The hook hashes the state again after a green run and writes the cache only if it equals the state before the run, via a temp file and `mv`. A missing file changes the hash; a file that vanishes while being hashed makes it fail, and a failed hash never hits or writes.

The cache stays one file per worktree. Concurrent sessions can overwrite each other's entry, which costs a re-run but never a wrong skip, since every entry was verified before and after its run.

`.claude/hooks/stop-check.test.sh` covers hit, misses on generated and `node_modules` changes, changes during the run and red runs, with a stub `mise` on `PATH` so the hook itself has no test-only switch.

## Consequences

The checks re-run after an install that changes `node_modules` or a codegen change. A run that regenerates a deleted dir is not cached, since the dir changed during it; the next stop hits if a cached state already has the same output, else runs once more. Hand edits to package files inside `node_modules` are still not in the key; reinstall or edit a tracked file to force a run. The before/after comparison cannot see a change that is made and reverted while the checks run; that state can be cached although the checks read the intermediate one. Other gitignored inputs and the environment are not in the key either: tool versions, the `oasdiff` binary that `test/codegen.test.ts` skips without, `.env` files. Add them here if they cause a wrong skip. The hook tests are run by hand (`sh .claude/hooks/stop-check.test.sh`), not in CI.
