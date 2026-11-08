# 0022. The Claude Code hooks turn off mise's tool auto-install; both guards stay in the hooks

- Status: accepted
- Date: 2026-11-08
- Amends: [0014](0014-stop-hook-never-rewrites-lockfile.md) ("the hook never modifies the working tree" now covers mise; the hint wording)

## Context

0014 says the hook never modifies the working tree, but it only stopped pnpm. mise installs a missing tool before running a task (`task_run_auto_install`, on by default), and when the version in `mise.toml` is not in `mise.lock` it also writes that version into the tracked `mise.lock` (issue #61). Reproduced on a clone of this repo: with `actionlint` bumped to `1.7.11` in `mise.toml` and not installed, `mise run` of any task installed it and rewrote `mise.lock` (66 lines changed).

Two more gaps from the same review. The pnpm guard (`pnpm_config_verify_deps_before_run=error`) is set by the hook, not by the `check:fast` task, so `mise run check:fast` by hand still lets pnpm re-sync `pnpm-lock.yaml`. And 0014's wording, "if dependencies and lockfile disagree", is too narrow: `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` also fires when `node_modules` is missing (a fresh worktree) or when `pnpm-workspace.yaml` settings changed since the last install. The hook's hint blamed `package.json` only.

## Decision

The Stop hook runs with `MISE_AUTO_INSTALL=false`, next to the pnpm setting for `check:fast`. It is mise's master switch: it also turns off `task.run_auto_install` (before a task), `exec_auto_install` (from a shim) and `not_found_auto_install` (on command-not-found), all on by default (checked with `mise settings get` on mise 2026.11.3). `MISE_TASK_RUN_AUTO_INSTALL=false` alone, used in an earlier revision of this PR, left the shims free to install. mise then installs nothing and never writes `mise.lock`; a tool that is not installed is left out silently (checked on the same clone: `mise.lock` unchanged, the tool still missing, no output). The PreToolUse and PostToolUse hooks (`mise run --quiet hook:guard`, `hook:biome` in `.claude/settings.json`) set the same variable, so no hook installs tools or writes `mise.lock`.

Before running the checks, the Stop hook asks `mise ls --no-global --missing` for this project's tools that are not installed. If there are any, it blocks with their names and "run `mise install`" (which installs them and updates `mise.lock` for a new version), runs no checks and caches nothing: a green run on whatever else is on `PATH` would otherwise be cached as green. Tools from the global mise config are not listed: the checks do not use them.

We tried `MISE_LOCKED=true` first. It also leaves `mise.lock` alone and still installs tools that `mise.lock` pins, but it warns "is not in the lockfile" for every tool in the global mise config, so every red run's output started with unrelated warnings, and it needs this platform's download URL in `mise.lock`, which lists only `linux-x64` and `macos-arm64`.

Both settings stay in the hooks, not in the `check:fast` task or `mise.toml`. Someone who runs `mise run check:fast` by hand after editing dependencies or tool versions usually wants pnpm and mise to sync, and sees the diff they caused. The hooks run on every Stop and edit, unasked, so it must not leave changes the agent did not make. CI runs `pnpm install --frozen-lockfile` after `mise-action` installs the tools, and is not affected either way.

The pnpm hint names every cause: no `node_modules`, or `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` changed since the last install. The action is unchanged, `pnpm install`.

The hook no longer fails silently without `jq` (a `mise.toml` tool, and the hook does not run through mise): it exits 1, a non-blocking error Claude Code shows, and says to activate mise. `.claude/hooks/stop-check.test.sh` checks the run's environment, the missing-tool block (no checks, nothing cached), the pnpm hint only for its error, and the missing-`jq` case with stdin read first.

## Consequences

A fresh environment without the project's tools installed gets a block naming them and "run mise install", instead of an automatic install. The missing-tool check runs only when the cache misses; uninstalling a tool without changing the tree is not caught until the next miss (tool versions are not in the cache key, 0015). Changing a version in `mise.toml` already needs an ADR (0013), and `mise install` updates the lockfile in the same change. The hook still writes outside the tree: its cache file sits in the git dir (0013).
