#!/bin/sh
# Stop: block once if a policy file changed without an ADR, or if the tree is
# red (lint, typecheck, test), skipping the checks if their inputs are unchanged
# since the last green run (ADRs 0013, 0015). oasdiff and build stay CI-only (ADR 0004).
# stop_hook_active is true on the retry after a block, so we never loop.
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

# Work in the session's checkout (hook input cwd), from its top level.
# Outside a work tree, rev-parse prints nothing and `cd ""` would succeed: guard it.
cd "$(printf '%s' "$input" | jq -r '.cwd // "."')" || exit 0
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
hash_files() { # <path>...: missing paths are skipped; a find error fails the hash
  for p; do shift; [ -e "$p" ] && set -- "$@" "$p"; done
  [ $# -gt 0 ] || return 0
  # No pipefail in sh: list to a temp file first so a failed traversal (a
  # directory removed or unreadable midway) is not hashed as a subset.
  list=$(mktemp) || return 1
  if find "$@" -type f -print0 2>/dev/null > "$list"; then
    LC_ALL=C sort -z < "$list" | xargs -0 shasum
    rc=$?
  else
    rc=1
  fi
  rm -f "$list"
  return "$rc"
}
key() { # <inputs hash>: empty if the inputs hash is empty
  [ -n "$1" ] || return 0
  g=$(hash_files playground/generated test/fixtures/generated) || return 0
  printf '%s\n%s' "$1" "$g" | shasum | cut -d' ' -f1
}
cache="$(git rev-parse --absolute-git-dir)/claude-stop-check"
before=$(inputs)
k=$(key "$before")
if [ -z "$k" ] || [ "$(cat "$cache" 2>/dev/null)" != "$k" ]; then
  # pnpm re-syncs pnpm-lock.yaml and node_modules before a script when
  # package.json dependencies differ; fail instead so the hook never edits the tree.
  if out=$(pnpm_config_verify_deps_before_run=error mise run check:fast 2>&1); then
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
      && hint="Lockfile or node_modules out of date with package.json: run pnpm install.
"
    reasons="${reasons:+$reasons

}${hint}mise run check:fast failed. Fix it before finishing:
$(printf '%s\n' "$out" | tail -40)"
  fi
fi

[ -n "$reasons" ] || exit 0
jq -n --arg r "$reasons" '{decision:"block",reason:$r}'
