# 0005. Patch `openapi-typescript-helpers` until upstream ships the fix

- Status: accepted
- Date: 2026-10-25

## Context

`Readable<T>` and `Writable<T>` map over `string & {}`, collapsing open enums. The fix is open upstream as openapi-ts/openapi-typescript#2766, unreleased.

## Decision

Carry the one-line fix as a pnpm patch (`patchedDependencies`, `patches/openapi-typescript-helpers@0.1.0.patch`), which replaced patch-package. Do not post a duplicate upstream PR.

## Consequences

A patch is not applied inside a consumer's `node_modules`, so consumers must patch themselves (documented in troubleshooting). Delete the patch, `patches/` and rule 7 of AGENTS.md once a helpers release contains #2766. Tracked by an issue labelled `blocked-upstream`.
