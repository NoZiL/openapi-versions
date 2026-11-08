# 0013. A Claude Code Stop hook enforces ADRs and a green tree

- Status: accepted
- Date: 2026-11-08

## Context

Agents finish sessions with a red tree or change policy files (workflows, `mise.toml`, `renovate.json`, `biome.json`, `pnpm-workspace.yaml`, dependencies) without recording the decision. Both are cheap to catch before the session ends. `mise run check` is "everything CI runs" and includes the oasdiff gate and the build, which are slow and already enforced by CI.

## Decision

`.claude/hooks/stop-check.sh` runs on `Stop`. It diffs the working tree against the merge-base with `main`. If a policy file changed and nothing under `docs/adr/` did, it blocks with "read docs/adr/README.md; add an ADR or say why not". It also runs the new `mise run check:fast` (lint, typecheck, test) and blocks on failure. It does nothing when `stop_hook_active` is set, so it blocks at most once per stop and cannot loop. It does nothing when the branch has no changes.

CI does not warn on the same paths. Renovate dependency bumps would trigger it constantly and the ADR requirement is a judgement ("or say why not"), which a hook can prompt for but a CI check cannot settle. Revisit if policy changes keep landing without ADRs from humans.

## Consequences

Agents see lint, type and test failures before finishing, and policy changes get an ADR or an explicit reason. The hook is local to Claude Code sessions; humans are covered by review. Only the first stop is checked: a second stop passes even if the tree is still red, and CI remains the real gate. Dependency changes are detected by comparing the dependency sections of `package.json` against the merge-base.
