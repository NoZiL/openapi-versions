# 0002. Open enums are declared with `x-extensible-enum`

- Status: accepted
- Date: 2026-10-25

## Context

Within a major a backend may add enum values, so an older client must tolerate unknown ones, while closed enums must stay closed so removing a value is still breaking.

## Decision

An enum is open only when the spec marks it `x-extensible-enum`. Codegen emits it as `"a" | "b" | (string & {})`. Consumers must give a `switch` over such an enum a `default` branch. Hand-editing a spec to pass the breaking gate is not allowed (see 0004).

## Consequences

The open/closed intent lives in the backend spec. openapi-fetch's `Readable<T>` collapses `string & {}` to an object type without the fix in 0005. openapi-typescript 7.14 will emit loose unions for `additionalProperties: true` string enums (#2415); evaluate whether it can replace our `transform` hook.
