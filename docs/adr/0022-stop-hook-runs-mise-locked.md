# 0022. The Stop hook runs mise locked; both guards stay in the hook

- Status: accepted
- Date: 2026-11-08
- Amends: [0014](0014-stop-hook-never-rewrites-lockfile.md) ("the hook never modifies the working tree" now covers mise; the hint wording)

## Context

0014 says the hook never modifies the working tree, but it only stopped pnpm. mise installs a missing tool before running a task (`task_run_auto_install`, on by default), and when the version in `mise.toml` is not in `mise.lock` it also writes that version into the tracked `mise.lock` (issue #61). Reproduced on a clone of this repo: with `actionlint` bumped to `1.7.11` in `mise.toml` and not installed, `mise run` of any task installed it and rewrote `mise.lock` (66 lines changed).

Two more gaps from the same review. The pnpm guard (`pnpm_config_verify_deps_before_run=error`) is set by the hook, not by the `check:fast` task, so `mise run check:fast` by hand still lets pnpm re-sync `pnpm-lock.yaml`. And 0014's wording, "if dependencies and lockfile disagree", is too narrow: `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` also fires when `node_modules` is missing (a fresh worktree) or when `pnpm-workspace.yaml` settings changed since the last install. The hook's hint blamed `package.json` only.

## Decision

The hook runs `check:fast` with `MISE_LOCKED=true` next to the pnpm setting. Locked, mise still installs a missing tool whose version `mise.lock` already pins, without touching the file (checked on the same clone after locking `1.7.11`, then uninstalling it); a version that is not in `mise.lock` is not installed and mise warns "is not in the lockfile". We chose it over `MISE_TASK_RUN_AUTO_INSTALL=false`, which also leaves `mise.lock` alone but would not install pinned tools in a fresh environment either. When the checks fail and the output has that warning, the hook adds a hint: run `mise install`, which installs the tool and updates `mise.lock`.

Both settings stay in the hook, not in the `check:fast` task. Someone who runs `mise run check:fast` by hand after editing dependencies or tool versions usually wants pnpm and mise to sync the lockfiles, and sees the diff they caused. The hook runs on every Stop, unasked, so it must not leave changes the agent did not make. CI runs `pnpm install --frozen-lockfile` and is not affected either way.

The pnpm hint names every cause: no `node_modules`, or `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` changed since the last install. The action is unchanged, `pnpm install`.

`.claude/hooks/stop-check.test.sh` checks that the stub `mise` sees both settings and that each hint appears only for its error.

## Consequences

With a tool version missing from `mise.lock`, the checks run without that tool: they fail (and the hook hints `mise install`) or pass on whatever else is on `PATH`. Changing a version in `mise.toml` already needs an ADR (0013), and `mise install` updates the lockfile in the same change. The hook still writes outside the tree: tool installs land in mise's data dir, and its cache file sits in the git dir (0013).
