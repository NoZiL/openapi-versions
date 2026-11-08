# 0011. Protect `main` with a repository ruleset

- Status: accepted
- Date: 2026-11-08

## Context

Anything that lands on `main` can run `release.yml` and publish to npm immediately (ADR 0009). `main` was unprotected, so a direct push, a force-push or a stray credential could skip CI and release.

## Decision

A repository ruleset named `main` targets the default branch. The only bypass actor is the repository admin role, in pull-request-only mode: the owner can merge a PR without waiting for `check` (for example when CI is down), but cannot push to `main` directly. The release bot has no bypass.

- changes go through a pull request, with 0 required approvals (a single maintainer cannot approve their own PR; raise it when a second maintainer joins)
- the `check` status check from `ci.yml` must pass
- force-push and deletion are blocked
- branches need not be up to date with `main` before merging, to avoid rebase churn on Renovate PRs

The release bot only pushes the Version Packages branch and tags, never `main`, and its App token triggers CI on that PR, so the release flow is unaffected.

## Consequences

Direct pushes to `main` fail, including from the owner and agents. A direct push was verified to be rejected on 2026-11-08. The first Version Packages PR after this change is the check that the release flow still merges; fix the ruleset, not the workflow, if it does not. If `check` is renamed, update the ruleset in the same change. Tag rules, a required-signature rule and a second reviewer are left for when the package has real consumers or a second maintainer.
