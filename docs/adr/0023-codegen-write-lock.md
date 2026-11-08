# 0023. Codegen serializes its write phase with a lock file in outDir and stages every file before renaming

- Status: accepted
- Date: 2026-11-09
- Amends: [0021](0021-codegen-replaces-files-in-place.md) (the write step of its Decision, and the Consequences notes on concurrent writers and I/O errors while writing)

## Context

0021 makes each file replace atomic, but its Consequences leave two gaps (issue #87). Two codegen runs on one `outDir` with different inputs (a Stop hook in one session, a manual regenerate in another) take no lock, so their renames can interleave and leave B's `schema.d.ts` next to A's `meta.ts`; both exit 0 and tsc fails until codegen runs again. And an I/O error while writing (disk full, EACCES) can leave the output part old, part new, because each file is written and renamed before the next.

A lockfile library (proper-lockfile and the like) would add a dependency for about 150 lines. `open(O_CREAT | O_EXCL)` is atomic on every local filesystem Node supports.

## Decision

- `build()` holds `<outDir>/.openapi-versions.lock` while it writes (temp cleanup, staging, renames, pruning), not while it reads specs and generates, so the lock lasts milliseconds and two runs still generate in parallel. Whichever run writes last leaves one whole generation.
- When every file already has the content it would write and there is no dropped major to prune, `build()` takes no lock and touches nothing, so a no-op regen still wakes no file watcher (0021). Old temps are then left for the next run that writes. The check runs outside the lock and is repeated under it, so a changing regen reads its existing output twice.
- The lock is created with `open(…, "wx")` and holds `{ pid, host, ns, token, since }` (`ns`: the Linux PID namespace from `/proc/self/ns/pid`, absent elsewhere). An empty lock left by a failed write of that JSON is removed; a lock that is not such an object has no owner and is taken over only by age. A waiter polls every 25 ms and reads the lock's content and mtime through one fd. It takes the lock over when the owner has this host and PID namespace and its PID is gone, or when the lock is older than 30 s (another host or container, or a reused PID). Takers-over go one at a time through `<lock>.takeover` (also `O_EXCL`), and the one holding it deletes the lock only if it still reads as the one judged stale. After 60 s of waiting, `build()` fails naming the lock and its owner. On Windows, `EPERM`/`EACCES` from creating the lock or its takeover gate count as held when the file is there (it is being deleted), and opening it that way counts as released; with no file there they are real errors.
- The lock is released in a `finally`, and only if its token is still ours. It is a dot file, so tsc, vite and Biome globs skip it; dropped-major pruning only looks at `v<n>` dirs.
- Every changed file is written to its temp first; only then are the temps renamed, in the same order as before (`meta.ts` first in each dir). An error while staging removes the temps and leaves the previous output whole. A rename that fails (unlikely: it allocates no data) stops the rest and removes their temps. The Windows fallback of 0021 applies only to the rename (a target another process holds open); a temp that cannot be created fails the staging, so it cannot hide a real permission error.
- No new dependency.

## Consequences

`test/codegen-lock.test.ts` covers waiting on a live holder (it fails if the lock is bypassed), skipping the lock on a no-op regen, taking over a dead, old or garbage lock, not taking over a fresh lock from another host or PID namespace, not taking over while another waiter is, release on error, not releasing a lock we lost, a staging error leaving the old output whole, and real concurrent processes ending on one generation. The last one rarely hits the race even without the lock, because the write phase is so short.

Still open: the last run to write wins even if it read the specs before the other run did, so a slow run with older specs can overwrite a newer generation (whole, but stale) until codegen runs again; issue #101. The no-op check is part of that: a run that finds its own generation on disk exits without writing, even if another run writes a different one right after. A rename failing midway still leaves the output mixed. A run whose write phase outlasts 30 s can have its lock taken over and then write at the same time as the new holder; it does not delete the new holder's lock. Taking over deletes the stale lock after re-reading it, so an owner past 30 s that releases in that instant, followed by a new creator, loses its lock the same way. Age is the lock file's mtime against the local clock, so a writer on another host or VM whose clock is more than 30 s behind has its fresh lock look stale. Over a network filesystem without atomic `O_EXCL`, the lock is advisory at best. A reader running while the specs change can still mix two generations (0021).
