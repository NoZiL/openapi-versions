# Contributing

Read [`AGENTS.md`](AGENTS.md) first: it holds the rules that must not be broken, and it applies to humans as much as to agents. Full docs are in [`docs/`](docs/README.md).

## Setup

```sh
mise install
pnpm install
```

`mise run check` runs everything CI runs (lint, typecheck, test, breaking-change gate, build).

## Before you start

Todos are GitHub Issues and design decisions are ADRs in [`docs/adr/`](docs/adr/README.md). Check both. If you change a design decision, add an ADR that supersedes the old one.

## Pull requests

- Branch from `main` and fill in the PR template.
- Run `pnpm changeset` for any change to the published package.
- Never edit `playground/generated/**` or `test/fixtures/generated/**`; change specs or config and re-run `pnpm codegen`.

## Merging

The repo allows **squash merge only**, and head branches are deleted automatically after merge. The PR title becomes the commit subject on `main` and the PR description becomes its body, so write the title as a [conventional commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`) and keep `Closes #<n>` in the description.

These are GitHub repository settings, not files in the repo. If they change, update this section.
