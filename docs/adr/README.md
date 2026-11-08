# Architecture decision records

One file per decision, `NNNN-title.md`, [MADR](https://adr.github.io/madr/) style. Copy `template.md`.

## Changing a decision

Accepted ADRs are immutable. To change one, add a new ADR that either:

- **supersedes** it: the new ADR replaces the whole decision and says so on a `- Supersedes:` line under its status. Set the old one's status to `superseded by NNNN` (the only edit an accepted ADR gets).
- **amends** it: the new ADR changes or extends part of the decision and the rest still stands. The amending ADR names the ADR and the part it changes on an `- Amends:` line under its status (some older ADRs, such as 0014, 0015, 0018, 0020 and 0021, say it in the title or the first sentence of Context instead). The amended ADR is not edited; its row in the index below gets `amended by NNNN` in the status column, so a reader of the old ADR finds the change from here. Read an amended ADR together with its amendments.

## When to write one

Add an ADR, or supersede an existing one, when a change:

- adds a tool or dependency
- changes CI, release or security policy
- changes the public API or the gating model
- reverses an earlier ADR

Small fixes, dependency bumps and refactors need none. Take the next free number on `origin/main` (fetch first).

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-separate-package-not-upstream.md) | Ship as a separate package, upstream only small fixes | accepted |
| [0002](0002-extensible-enums-via-x-extensible-enum.md) | Open enums are declared with `x-extensible-enum` | accepted |
| [0003](0003-gating-model.md) | Newer operations go through `$gated` + `gate()` or `<Feature>` | accepted |
| [0004](0004-oasdiff-breaking-gate.md) | oasdiff gates every consecutive spec pair | accepted |
| [0005](0005-patch-openapi-typescript-helpers.md) | Patch `openapi-typescript-helpers` until upstream ships the fix | accepted, amended by 0017 |
| [0006](0006-tooling-mise-pnpm-biome.md) | mise, pnpm, Biome, Vitest, Changesets, Renovate; no turbo yet | accepted |
| [0007](0007-mit-license.md) | MIT license | accepted |
| [0008](0008-prereleases-via-snapshots.md) | Prereleases are on-demand snapshots from `main` under the `next` tag | accepted |
| [0009](0009-direct-publish-trusted-publishing.md) | Publish directly with npm trusted publishing, no staging | accepted |
| [0010](0010-stacked-prs-gh-stack.md) | Stacked PRs with `gh stack`, squash-merged atomically | proposed |
| [0011](0011-main-branch-ruleset.md) | Protect `main` with a ruleset: PR and `check` required, admin bypass via PR only | accepted |
| [0012](0012-typescript-range-follows-openapi-typescript.md) | `typescript` range follows `openapi-typescript`'s peer range; no peer overrides | superseded by 0017 |
| [0013](0013-stop-hook-adr-and-check.md) | Claude Code Stop hook blocks once on missing ADR or red lint/typecheck/test | accepted, amended by 0014, 0015 |
| [0014](0014-stop-hook-never-rewrites-lockfile.md) | Stop hook fails instead of re-syncing the lockfile; amends 0013 | accepted, amended by 0020, 0022 |
| [0015](0015-stop-hook-cache-key-covers-check-inputs.md) | Stop hook cache key covers installed deps and generated output; cached only if the run left the inputs unchanged; amends 0013 | accepted, amended by 0020 |
| [0016](0016-build-with-tsdown.md) | Build with tsdown; `.d.ts` from TypeScript 5, no dev-only TS 7 yet | accepted, amended by 0018 |
| [0017](0017-support-openapi-typescript-and-openapi-typesafe.md) | Support openapi-typescript and openapi-typesafe side by side; TS 5.4 to 7 on the typesafe path; amends 0005, supersedes 0012 | accepted, amended by 0019 |
| [0018](0018-isolated-declarations-oxc-dts.md) | `.d.ts` from Oxc with `isolatedDeclarations` on `src/` + `codegen/`; explicit public return types; amends 0016 | accepted |
| [0019](0019-open-enums-ir-node-on-typesafe-path.md) | The openapi-typesafe open-enum transform returns an IR node, not type text; parity ignores `\uXXXX` escaping; amends 0017 | accepted |
| [0020](0020-check-fast-runs-codegen-once.md) | `check:fast` runs each codegen once as a shared mise dependency; typecheck and test only read; amends 0014, 0015 | accepted, amended by 0021 |
| [0021](0021-codegen-replaces-files-in-place.md) | Codegen replaces generated files atomically in place, skips unchanged ones, prunes dropped majors; no `rm -rf` first; amends 0020 | accepted |
| [0022](0022-stop-hook-no-mise-auto-install.md) | Claude Code hooks turn off mise's tool auto-install (`MISE_AUTO_INSTALL=false`) so `mise.lock` is never rewritten; the Stop hook blocks on missing project tools before the checks; lockfile guards stay in the hooks; amends 0014 | accepted |
