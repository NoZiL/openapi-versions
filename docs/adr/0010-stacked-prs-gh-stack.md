# 0010. Stacked PRs with `gh stack`

- Status: proposed
- Date: 2026-11-08

## Context

Some work (e.g. the Node 26 upgrade, #37) splits into dependent steps. The repo allows squash merge only (merge commits and rebase merges are disabled, branches are deleted on merge). Squashing the bottom PR of a hand-made stack rewrites its commits, so every PR above it needs a manual rebase and retarget.

## Decision

Use the official `github/gh-stack` extension (`gh extension install github/gh-stack`) for multi-PR work. It is optional: single PRs stay as they are.

Squash-only compatibility, from the extension's docs and `--help` (not yet proven in this repo):

- `gh stack merge --squash` merges the stack through GitHub's atomic stack merge. The PRs are squashed into the base branch in one all-or-nothing operation, so there is no per-PR rebase after the bottom one lands.
- `gh stack sync` and `gh stack rebase` cascade-rebase the branches and follow GitHub retargeting the stack when a base branch is deleted.
- Branch protection and rulesets are evaluated by GitHub at merge time. `main` has none today.
- With a merge queue the queue chooses the method; keep it on squash.

Always pass `--squash` (or pick squash in the wizard) when merging a stack.

## Consequences

The first real stack is the validation: confirm `gh stack merge --squash` lands every PR as one squash commit each, with `main` history linear. Mark this ADR accepted then, or supersede it if the stack needs manual rebases after the squash.
Each PR in a stack still needs its own changeset (when it touches the published package) and passing CI.
