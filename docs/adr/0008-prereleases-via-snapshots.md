# 0008. Prereleases via on-demand snapshots

- Status: accepted
- Date: 2026-11-02

## Context

The repo is trunk-based on `main` and releases when the Version Packages PR is merged (npm trusted publishing, no token). Consumers sometimes need unreleased changes. Changesets offers pre mode (`x.y.z-rc.n`, state in `.changeset/pre.json`) and snapshots (`x.y.z-next-<timestamp>`). Pre mode on `main` turns every Version Packages PR into a prerelease and blocks stable hotfixes; a long-lived `next` branch means two integration branches to keep in sync.

## Decision

Stay trunk-based. Prereleases are snapshots published by running the Release workflow manually (`workflow_dispatch`, `main` only) with `changeset version --snapshot next` and `changeset publish --tag next --no-git-tag`. `snapshot.useCalculatedVersion` makes the version read `0.2.0-next-…`. The job fails when no changesets are pending. The `latest` tag is never touched. No automatic snapshot on push.

## Consequences

No extra branch, no `pre.json`, stable releases are never blocked. Snapshot versions are timestamped, not a tidy `rc.1`, `rc.2` sequence, and each one stays on npm. Revisit automatic snapshots on push once a downstream app consumes `@next`, and pre mode on `main` only for a short stabilization window before a major.
