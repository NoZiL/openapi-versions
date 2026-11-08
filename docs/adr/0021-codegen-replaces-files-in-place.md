# 0021. Codegen replaces generated files in place instead of deleting the dir first

- Status: accepted
- Date: 2026-11-08

## Context

Amends [0020](0020-check-fast-runs-codegen-once.md). `pnpm codegen:playground` and `pnpm codegen:test` ran `rm -rf <outDir>` before codegen, which then wrote each file with `writeFileSync`. 0020 keeps that from racing within one `mise run check:fast`, but its Consequences note that readers outside that run still race: a second session's Stop hook in the same worktree (0015 allows for it), or `pnpm playground` (vite) while a hook regenerates (issue #79). Reproduced with `pnpm codegen:test` looping beside the readers: 10 of 10 `tsc --noEmit` and 10 of 10 `vitest run` failed.

Generating into a temp dir and renaming it over `outDir` does not close the gap on POSIX: `rename` cannot replace a non-empty directory, so the swap is two renames with a moment where `outDir` is missing. A symlink swap is atomic but makes `outDir` a symlink, which tools resolve differently. And a reader that loads files over time (tsc, vite) can still mix two generations either way.

## Decision

- `build()` generates every file in memory first and writes only if all majors succeed, so an error while generating (a missing spec, a generator that throws) leaves the previous output whole. An I/O error while writing can still leave it part old, part new.
- It never deletes the output before writing it. Each file is written to a temp file with a unique name (`.<file>.<uuid>.tmp`) in the same dir and renamed over the target, so a reader sees the old file or the new one, never a missing or half-written one.
- A file whose content is unchanged is not written, so a regen with the same specs touches nothing (no vite reload, no mtime change).
- After writing, `build()` removes `<outDir>/v<n>` dirs for majors no longer in the config, but only those whose `meta.ts` starts with codegen's header, so a hand-written `v2/` survives; `meta.ts` is written first in each dir so a run killed midway still marks it. It also removes temp files older than 10 minutes, left by a run killed between write and rename. That replaces the cleanup `rm -rf` used to do; nothing else in `outDir` is removed.
- On Windows, where replacing a file another process holds open fails (EPERM/EBUSY/EACCES), it falls back to writing the file in place, as before.
- The `codegen:*` scripts drop `rm -rf`.

## Consequences

With codegen looping and its output actually changing (alternating specs with and without a description), 0 of 10 `tsc --noEmit` and 0 of 10 `vitest run` failed; the old scripts failed 5 of 5 under the same loop. `test/codegen.test.ts` covers skip-if-unchanged, replace, pruning, old temp files, and a failing later major writing nothing; nothing in CI tests the concurrency.

A reader running while the specs change can still see some files from the old generation and some from the new, which may fail one check. Two codegen runs on the same `outDir` with different inputs (a spec edited while another session's hook regenerates) take no lock, so the files left on disk can mix both runs until codegen runs again; tracked as a follow-up. The Windows fallback reopens the old gap for that file. A file in `outDir` that codegen no longer writes (other than a dropped major's dir) stays until deleted by hand. 0020's mise `depends` still make each codegen run once per `check:fast`; that is now about cost, not correctness.
