# 0009. Publish directly with npm trusted publishing

- Status: accepted
- Date: 2026-11-06

## Context

The package is a client library other apps install, so it is a supply-chain target. Trusted publishing (GitHub OIDC) replaces a stored npm token, with provenance. npm's trusted publisher can be set to stage a publish, which a human then approves in npm, or to publish directly. Staging adds a gate in a separate trust domain from GitHub. But `changesets/action` tags and creates the GitHub release as soon as `changeset publish` exits 0, which for a staged version is before it is live. A staged version also cannot be staged twice, so re-running a job fails with a 409.

## Decision

Publish directly. The trusted publisher on npm (`NoZiL/openapi-versions`, `release.yml`, no environment) has the plain publish permission. The only gate is merging the Version Packages PR. Changesets then pushes the `openapi-versions@<version>` tag and creates the GitHub release. Snapshots (ADR 0008) publish directly under `next` and create no tag or release (`--no-git-tag`).

## Consequences

Tags, releases and snapshots work without extra steps. Anything that can run `release.yml` on `main` can publish immediately, and unpublishing is limited. Mitigate with SHA-pinned actions, a ruleset on `main`, and a narrowly scoped release bot key. Revisit staging, with tagging and the release moved after promotion, when the package has real consumers or a second maintainer, and before 1.0.
