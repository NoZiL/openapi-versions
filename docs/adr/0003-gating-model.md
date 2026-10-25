# 0003. Newer operations go through `$gated` + `gate()` or `<Feature>`

- Status: accepted
- Date: 2026-10-25

## Context

One build runs against backends from the floor up to the newest spec. Calling an operation the backend lacks fails at runtime.

## Decision

Operations introduced after the floor are absent from the plain `$api` type. Queries use `$gated` with `gate()`, mutations use `<Feature>`. Components never compare version numbers; they ask `useSupports` / `useHasField`. The floor needs its own spec file.

## Consequences

Missing-feature handling is a compile-time concern. Raising the floor turns gated operations into ordinary ones, and dead gates become type errors to clean up.
