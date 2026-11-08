# 0023. Codegen serializes its write phase with a lock file in outDir and stages every file before renaming

- Status: accepted
- Date: 2026-11-09
- Amends: [0021](0021-codegen-replaces-files-in-place.md) (the write step of its Decision, and the Consequences notes on concurrent writers and I/O errors while writing)

## Context

0021 makes each file replace atomic, but its Consequences leave two gaps (issue #87). Two codegen runs on one `outDir` with different inputs (a Stop hook in one session, a manual regenerate in another) take no lock, so their renames can interleave and leave B's `schema.d.ts` next to A's `meta.ts`; both exit 0 and tsc fails until codegen runs again. And an I/O error while writing (disk full, EACCES) can leave the output part old, part new, because each file is written and renamed before the next.

A lockfile library (proper-lockfile and the like) would add a dependency for about 100 lines. `open(O_CREAT | O_EXCL)` is atomic on every local filesystem Node supports.

## Decision

- `build()` holds `<outDir>/.openapi-versions.lock` while it writes (temp cleanup, staging, renames, pruning), not while it merges and generates, so the lock lasts milliseconds and two runs still generate in parallel. Whichever run writes last leaves one whole generation.
- The lock is created with `open(…, "wx")` and holds `{ pid, host, token, since }`. A waiter polls every 25 ms. It takes the lock over when the owner is on this host and its PID is gone, or when the lock is older than 30 s (another host or container sharing the dir, or a reused PID). Taking over renames the lock aside and checks it is the one judged stale before deleting it; if a new holder's lock was moved instead, it is put back with `link`. After 60 s of waiting on a live holder, `build()` fails with the lock path and owner.
- The lock is released in a `finally`, and only if its token is still ours. It is a dot file, so tsc, vite and Biome globs skip it, and `pruneDroppedMajors` only looks at `v<n>` dirs.
- Every changed file is written to its temp first; only then are the temps renamed, in the same order as before (`meta.ts` first in each dir). An error while staging removes the temps and leaves the previous output whole. A rename that fails (unlikely: it allocates no data) stops the rest and removes their temps.
- No new dependency.

## Consequences

`test/codegen-lock.test.ts` covers waiting on a live holder, taking over a dead or old lock, not taking over a fresh lock from another host, release on error, not releasing a lock we lost, a staging error leaving the old output whole, and real concurrent processes ending on one generation. The last one rarely hits the race even without the lock (the write phase is that short), so the waiting test is the regression check.

Still open: a rename failing midway leaves the output mixed, as before. A run whose write phase outlasts 30 s can have its lock taken over; it then does not delete the new holder's lock, but the two may write at once. Two waiters taking over the same stale lock in the same instant can both end up holding it, if the `link` that puts a moved lock back loses to a third creator. Over a network filesystem without atomic `O_EXCL` the lock is advisory at best. The Windows in-place fallback from 0021 still applies per file. A reader running while the specs change can still mix two generations (0021).
