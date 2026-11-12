# Contributing

Read [`AGENTS.md`](AGENTS.md) first: it holds the rules that must not be broken, and it applies to humans as much as to agents. Full docs are in [`docs/`](docs/README.md).

## Setup

```sh
mise install
pnpm install
```

`mise run check` runs everything CI runs (lint, workflow lint, typecheck, test, hook tests, breaking-change gate, build). The hook tests need `git`, `jq`, `shasum`, `node` and `mise`..

## Before you start

Todos are GitHub Issues and design decisions are ADRs in [`docs/adr/`](docs/adr/README.md). Check both. If you change a design decision, add an ADR that supersedes the old one.

## Pull requests

- Branch from `main` and fill in the PR template.
- Run `pnpm changeset` for any change to the published package. Docs-only, CI-only and tooling-only PRs need none.
- Follow the rules in [`AGENTS.md`](AGENTS.md), including never editing generated output.

## Merging

The repo allows **squash merge only**, and head branches are deleted automatically after merge. The PR title becomes the commit subject on `main` (GitHub appends ` (#<n>)`) and the PR description becomes its body, so write the title as a [conventional commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`). If the PR resolves an issue, put `Closes #<n>` in the description; otherwise remove that line from the template.

These are GitHub repository settings, not files in the repo. If they change, update this section.

## Releases

`main` is the trunk. Merging the Version Packages PR publishes to the `latest` tag, then Changesets pushes the `openapi-versions@<version>` git tag and creates the GitHub release. To try unreleased changes, run the **Release** workflow manually on `main` (Actions → Release → Run workflow). It publishes a snapshot such as `0.2.0-next-20261102123456` under the `next` tag, built from the pending changesets, and does nothing if there are none. Install it with `npm i openapi-versions@next`. Snapshots create no git tag and no GitHub release. See [ADR 0008](docs/adr/0008-prereleases-via-snapshots.md).

Publishing is direct, through npm trusted publishing (GitHub OIDC): no npm token is stored, and the trusted publisher on npm must keep the plain publish permission for `NoZiL/openapi-versions` and `release.yml`. Do not switch it to staged publishing without adjusting the workflow: Changesets would tag and create the release when a version is staged, before it is live. See [ADR 0009](docs/adr/0009-direct-publish-trusted-publishing.md).

### npm setup (maintainers)

The package needs a trusted publisher on npm (package settings → Trusted Publisher): repository `NoZiL/openapi-versions`, workflow `release.yml`, no environment, plain publish permission. A pending config must be validated by a first successful publish before it expires, otherwise npm rejects the run with `403 OIDC permission denied`; delete and re-create it if it expired. The workflow also needs the `APP_ID` and `APP_PRIVATE_KEY` secrets of the release bot.
