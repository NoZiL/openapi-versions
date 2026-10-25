# 0007. MIT license

- Status: accepted
- Date: 2026-10-25

## Context

`package.json` said `UNLICENSED` while the repo is public, and a license is required before the first npm release. The package builds on openapi-typescript, openapi-fetch and openapi-react-query, which are MIT, and [ADR 0001](0001-separate-package-not-upstream.md) keeps the door open to upstreaming small fixes.

## Decision

License the package under MIT. `LICENSE` holds the text, `package.json` sets `"license": "MIT"`.

## Consequences

Matches the openapi-ts ecosystem and lets fixes move upstream without relicensing. Offers no explicit patent grant; revisit (Apache-2.0) only if that becomes a requirement.
