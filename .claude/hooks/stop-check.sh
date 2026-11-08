#!/bin/sh
# Stop: block once if a policy file changed without an ADR, or if the tree is
# red (lint, typecheck, test), skipping the checks if their inputs are unchanged
# since the last green run (ADRs 0013, 0015). oasdiff and build stay CI-only (ADR 0004).
# stop_hook_active is true on the retry after a block, so we never loop.
input=$(cat) # read stdin first, even when exiting early
# jq parses the input: without it every check below would be skipped unnoticed.
# Exit 1 is a non-blocking error that Claude Code shows the user. jq comes from
# mise.toml, and this hook does not run through mise.
command -v jq >/dev/null 2>&1 || {
  echo "stop-check: jq not found on PATH, checks skipped. Activate mise in the shell that starts Claude Code (mise install if jq is not installed)." >&2
  exit 1
}
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ] && exit 0

# Work in the session's checkout (hook input cwd, which Claude Code always sends;
# the process cwd only when it is absent), from its top level.
# `cd ""` succeeds as a no-op, so guard both empty values: an empty cwd, and
# rev-parse printing nothing outside a work tree.
cwd=$(printf '%s' "$input" | jq -r '.cwd // "."' 2>/dev/null) && [ -n "$cwd" ] || exit 0
cd "$cwd" 2>/dev/null || exit 0
top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -n "$top" ] && cd "$top" || exit 0
base=origin/main
git rev-parse --verify -q "$base" >/dev/null || base=main
mb=$(git merge-base HEAD "$base" 2>/dev/null) || exit 0

# Committed, uncommitted and untracked changes since the branch point.
changed=$( { git diff --name-only "$mb"; git ls-files -o --exclude-standard; } | sort -u)
[ -n "$changed" ] || exit 0

reasons=""

policy=$(printf '%s\n' "$changed" | grep -E '^(\.github/workflows/|mise\.toml$|renovate\.json$|biome\.json$|pnpm-workspace\.yaml$)')
deps_of() { jq -S '[.dependencies,.devDependencies,.peerDependencies,.optionalDependencies,.pnpm]'; }
if printf '%s\n' "$changed" | grep -qx 'package.json' \
  && [ "$(git show "$mb:package.json" 2>/dev/null | deps_of)" != "$(deps_of < package.json)" ]; then
  policy="${policy:+$policy
}package.json (dependencies)"
fi
if [ -n "$policy" ] && ! printf '%s\n' "$changed" | grep -q '^docs/adr/'; then
  reasons="Policy files changed with no ADR under docs/adr/:
$policy
Read docs/adr/README.md; add an ADR or say why not."
fi

# Skip the slow checks when nothing they read changed since the last green run.
# inputs = HEAD + tracked diff + untracked paths and contents + what pnpm
# installed (its copy of the lockfile; gitignored, so not in the diff).
# generated = the codegen dirs; check:fast regenerates them from the inputs.
# Each prints nothing if hashing fails (e.g. a file vanished), so the cache never hits.
inputs() {
  s=$(git rev-parse HEAD && git diff --binary --no-ext-diff --no-textconv HEAD \
    && git ls-files -o --exclude-standard \
    && git ls-files -o --exclude-standard -z | xargs -0 git hash-object -- \
    && hash_files node_modules/.pnpm/lock.yaml) || return 0
  printf '%s' "$s" | shasum | cut -d' ' -f1
}
hash_files() { # <path>...: missing paths are skipped; a find, shasum or sort error fails the hash
  for p; do shift; [ -e "$p" ] && set -- "$@" "$p"; done
  [ $# -gt 0 ] || return 0
  # No pipefail in sh: capture first so a failed traversal (a directory removed
  # or unreadable midway) or a failed shasum is not hashed as a subset.
  h=$(find "$@" -type f -exec shasum {} + 2>/dev/null) || return 1
  printf '%s\n' "$h" | LC_ALL=C sort
}
key() { # <inputs hash>: empty if the inputs hash is empty
  [ -n "$1" ] || return 0
  g=$(hash_files playground/generated test/fixtures/generated) || return 0
  printf '%s\n%s' "$1" "$g" | shasum | cut -d' ' -f1
}
cache="$(git rev-parse --absolute-git-dir)/claude-stop-check"
before=$(inputs)
k=$(key "$before")
# Neither tool may edit the tree (ADRs 0014, 0022). mise installs missing tools
# (before a task, from a shim, on command-not-found) and writes a version mise.lock
# lacks into it: MISE_AUTO_INSTALL=false turns all of that off. pnpm re-syncs
# pnpm-lock.yaml and node_modules before a script when they are out of date:
# verify-deps=error fails instead.
export MISE_AUTO_INSTALL=false
if [ -z "$k" ] || [ "$(cat "$cache" 2>/dev/null)" != "$k" ]; then
  # Tools from this project's mise.toml that are not installed: the checks would
  # run on whatever else is on PATH, and a green run would be cached. Block before
  # running them. Global tools are left out: the checks do not use them.
  missing=$(mise ls --no-global --missing 2>/dev/null | awk '{printf "%s%s@%s", (NR > 1 ? ", " : ""), $1, $2}')
  if [ -n "$missing" ]; then
    reasons="${reasons:+$reasons

}Tools from mise.toml not installed: $missing. Run mise install (it updates mise.lock for a new version); the checks did not run."
  elif out=$(pnpm_config_verify_deps_before_run=error mise run check:fast 2>&1); then
    # Record green only if no input changed during the run (another tool, a
    # second session in this worktree). The key takes the generated dirs as the
    # checks left them, so regenerated output does not cost another run.
    after=$(inputs)
    k=$(key "$after")
    if [ -n "$k" ] && [ "$after" = "$before" ]; then
      tmp=$(mktemp "$cache.XXXXXX") \
        && { printf '%s' "$k" > "$tmp" && mv -f "$tmp" "$cache" || rm -f "$tmp"; }
    fi
  else
    hint=""
    printf '%s' "$out" | grep -q ERR_PNPM_VERIFY_DEPS_BEFORE_RUN \
      && hint="Dependencies not installed or out of date (no node_modules, or package.json, pnpm-lock.yaml or pnpm-workspace.yaml changed since the last install): run pnpm install.
"
    reasons="${reasons:+$reasons

}${hint}mise run check:fast failed. Fix it before finishing:
$(printf '%s\n' "$out" | tail -40)"
  fi
fi

[ -n "$reasons" ] || exit 0
jq -n --arg r "$reasons" '{decision:"block",reason:$r}'
