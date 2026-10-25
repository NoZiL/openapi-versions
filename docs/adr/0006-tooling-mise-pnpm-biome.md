# 0006. mise, pnpm, Biome, Vitest, Changesets, Renovate; no turbo yet

- Status: accepted
- Date: 2026-10-25

## Context

The repo had no pinned toolchain, lint, CI or release flow. Upstream uses pnpm and turbo.

## Decision

mise pins node, pnpm and oasdiff. pnpm is the package manager (`packageManager` pinned). Biome does lint and format. Vitest runs tests. Changesets drive versions and changelogs, released from GitHub Actions. Renovate updates dependencies with a minimum release age. Turbo is deferred: it is a single package with a short task chain.

## Consequences

Revisit turbo if the repo splits into a workspace (core, codegen, playground).
