# 0022. The Stop hook turns off mise's tool auto-install; both guards stay in the hook

- Status: accepted
- Date: 2026-11-08
- Amends: [0014](0014-stop-hook-never-rewrites-lockfile.md) ("the hook never modifies the working tree" now covers mise; the hint wording)

## Context

0014 says the hook never modifies the working tree, but it only stopped pnpm. mise installs a missing tool before running a task (`task_run_auto_install`, on by default), and when the version in `mise.toml` is not in `mise.lock` it also writes that version into the tracked `mise.lock` (issue #61). Reproduced on a clone of this repo: with `actionlint` bumped to `1.7.11` in `mise.toml` and not installed, `mise run` of any task installed it and rewrote `mise.lock` (66 lines changed).

Two more gaps from the same review. The pnpm guard (`pnpm_config_verify_deps_before_run=error`) is set by the hook, not by the `check:fast` task, so `mise run check:fast` by hand still lets pnpm re-sync `pnpm-lock.yaml`. And 0014's wording, "if dependencies and lockfile disagree", is too narrow: `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` also fires when `node_modules` is missing (a fresh worktree) or when `pnpm-workspace.yaml` settings changed since the last install. The hook's hint blamed `package.json` only.

## Decision

The hook runs `check:fast` with `MISE_TASK_RUN_AUTO_INSTALL=false` next to the pnpm setting. mise then installs nothing before the checks and never writes `mise.lock`; a tool that is not installed is left out of the run, silently (checked on the same clone: `mise.lock` unchanged, the tool still missing, no output). When the checks fail, the hook asks `mise ls --local --missing` for this project's tools that are not installed and, if there are any, names them in a hint: run `mise install`, which installs them and updates `mise.lock` for a new version. Tools from the global mise config are not listed: the checks do not use them.

We tried `MISE_LOCKED=true` first. It also leaves `mise.lock` alone and still installs tools that `mise.lock` pins, but it warns "is not in the lockfile" for every tool in the global mise config, so every red run's output started with unrelated warnings, and it needs this platform's download URL in `mise.lock`, which lists only `linux-x64` and `macos-arm64`.

Both settings stay in the hook, not in the `check:fast` task. Someone who runs `mise run check:fast` by hand after editing dependencies or tool versions usually wants pnpm and mise to sync, and sees the diff they caused. The hook runs on every Stop, unasked, so it must not leave changes the agent did not make. CI runs `pnpm install --frozen-lockfile` after `mise-action` installs the tools, and is not affected either way.

The pnpm hint names every cause: no `node_modules`, or `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` changed since the last install. The action is unchanged, `pnpm install`.

The hook no longer fails silently without `jq` (a `mise.toml` tool, and the hook does not run through mise): it exits 1, a non-blocking error Claude Code shows, and says to activate mise. `.claude/hooks/stop-check.test.sh` checks the run's environment, each hint only for its cause, and the missing-`jq` case.

## Consequences

A fresh environment without the project's tools installed gets a red run (or a green one on whatever else is on `PATH`) and the "run mise install" hint, instead of an automatic install. Changing a version in `mise.toml` already needs an ADR (0013), and `mise install` updates the lockfile in the same change. The hook still writes outside the tree: its cache file sits in the git dir (0013).
