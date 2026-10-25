# 0001. Ship as a separate package, upstream only small fixes

- Status: accepted
- Date: 2026-10-25

## Context

The package builds on openapi-typescript, openapi-fetch and openapi-react-query. Upstreaming it would put multi-spec merge, an oasdiff gate, runtime gating, a React layer and a CLI into a monorepo whose maintainers have no stated process for features of that size.

## Decision

Keep `openapi-versions` as its own package. Upstream only narrow fixes (the `Readable`/`Writable` primitive guard, openapi-ts/openapi-typescript#2766) and rely on upstream features where they exist (loose enums, #2415).

## Consequences

Own release cadence and no sign-off needed, but we track upstream 0.x breaking changes ourselves (Renovate groups the openapi-ts packages) and discoverability is lower. Revisit if upstream adopts a plugin or transform hook that covers codegen.
