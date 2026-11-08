# 0012. The `typescript` range follows `openapi-typescript`'s peer range

- Status: accepted
- Date: 2026-11-08

## Context

`typescript` is a runtime `dependency` of this package, and `openapi-typescript` (a peer dependency) generates types through the TypeScript compiler API. `openapi-typescript@7.13.0` declares `typescript: ^5.x` as a peer. TypeScript 6 was merged via Renovate (#49) and passed CI, but that put TS 6 under a peer range that excludes it, and consumers would have inherited the mismatch and a peer warning. A pnpm `peerDependencyRules` override would only silence it inside this repo, not for consumers, and would not show that codegen works for them. Upstream support is in review ([#2818](https://github.com/openapi-ts/openapi-typescript/pull/2818), tracked in [#2723](https://github.com/openapi-ts/openapi-typescript/issues/2723)); TypeScript 7 is a separate problem (no JS compiler API, [#2841](https://github.com/openapi-ts/openapi-typescript/issues/2841)).

## Decision

Our `typescript` range stays inside the range `openapi-typescript` declares. We do not override peer ranges. Renovate holds `typescript` below 6 until a published `openapi-typescript` widens its peer; then we bump and lift the hold.

## Consequences

We stay on TS 5.x for now and ship a combination upstream declares supported. The TS 6 side effect (`vite/client` types for CSS side-effect imports in the playground) stays, since it is harmless on TS 5. Revisit when `openapi-typescript` publishes a release with a widened peer range (tracked in a `blocked-upstream` issue). Whether `typescript` should be a peer instead of a dependency of ours is a separate question.
