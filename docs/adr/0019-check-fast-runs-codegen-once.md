# 0019. check:fast runs codegen once, as a shared mise dependency

- Status: accepted
- Date: 2026-11-08

## Context

Amends [0014](0014-stop-hook-never-rewrites-lockfile.md) and [0015](0015-stop-hook-cache-key-covers-check-inputs.md). `pnpm typecheck` and `pnpm test` each start with `rm -rf` of a generated dir and codegen. `mise run check:fast` ran them in parallel, so typecheck's `codegen:test` could delete `test/fixtures/generated` while vitest read it (issue #62). Not seen in 30 normal runs, but with `codegen:test` looping beside them, 9 of 10 `vitest run` / `tsc --noEmit` runs failed with "Cannot find module './fixtures/generated'".

## Decision

mise has `codegen:playground` and `codegen:test` tasks. The mise `typecheck` task depends on both and runs `pnpm typecheck:tsc` (`tsc --noEmit`). The mise `test` task depends on `codegen:test` and runs `pnpm test:run` (`vitest run`). mise runs each dependency once per run, before its dependents, so nothing deletes a generated dir while a check reads it. `pnpm typecheck` and `pnpm test` call the same read-only scripts after their own codegen, so CI, manual runs and `check:fast` run the same commands. The order differs: `pnpm codegen` runs the two codegens one after the other, and mise runs them in parallel, so neither may read the other's output. Every check still goes through a pnpm script, so 0014's `verify-deps-before-run=error` still applies to each one.

## Consequences

0015's statement that the run regenerates both generated dirs now holds because of the mise `depends` lines, not the pnpm scripts. Removing a `depends` breaks the hook's cache assumption and brings the race back. Nothing tests this. The `rm -rf` in the codegen scripts still races with readers outside one mise run, such as a second session's hook or `pnpm playground`.
