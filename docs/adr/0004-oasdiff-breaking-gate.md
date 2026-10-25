# 0004. oasdiff gates every consecutive spec pair

- Status: accepted
- Date: 2026-10-25

## Context

The whole model assumes minors within a major are additive. A silent breaking change would make the merged contract wrong.

## Decision

Codegen runs `oasdiff breaking --fail-on ERR` on each consecutive pair of specs within a major and fails on a breaking pair. The fix is in the backend, an `x-extensible-enum`, or a new major, never an edit to a spec. oasdiff is pinned in `mise.toml` and CI; `MIN_OASDIFF_VERSION` guards other environments.

## Consequences

An external binary is a hard dependency of codegen. Renovate does not automerge oasdiff bumps.
