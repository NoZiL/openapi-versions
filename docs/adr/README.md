# Architecture decision records

One file per decision, `NNNN-title.md`, [MADR](https://adr.github.io/madr/) style. Accepted ADRs are immutable: to change a decision, add a new ADR that supersedes it and set the old one's status to `superseded by NNNN`. Copy `template.md`.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-separate-package-not-upstream.md) | Ship as a separate package, upstream only small fixes | accepted |
| [0002](0002-extensible-enums-via-x-extensible-enum.md) | Open enums are declared with `x-extensible-enum` | accepted |
| [0003](0003-gating-model.md) | Newer operations go through `$gated` + `gate()` or `<Feature>` | accepted |
| [0004](0004-oasdiff-breaking-gate.md) | oasdiff gates every consecutive spec pair | accepted |
| [0005](0005-patch-openapi-typescript-helpers.md) | Patch `openapi-typescript-helpers` until upstream ships the fix | accepted |
| [0006](0006-tooling-mise-pnpm-biome.md) | mise, pnpm, Biome, Vitest, Changesets, Renovate; no turbo yet | accepted |
| [0007](0007-mit-license.md) | MIT license | accepted |
