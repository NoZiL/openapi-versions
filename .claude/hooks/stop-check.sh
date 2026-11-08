#!/bin/sh
# Stop: block once if a policy file changed without an ADR, or if the tree is
# red (lint, typecheck, test), skipping the checks if their inputs are unchanged
# since the last green run (ADR 0015). oasdiff and build stay CI-only (ADR 0004).
# stop_hook_active is true on the retry after a block, so we never loop.
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

base=origin/main
git rev-parse --verify -q "$base" >/dev/null || base=main
cd "$(git rev-parse --show-toplevel)" || exit 0
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
# State = HEAD + tracked diff + untracked paths and contents + what pnpm
# installed + the generated dirs (gitignored, so not in the diff). Empty if
# hashing fails (e.g. a file vanished mid-hash), so the cache never hits.
state() {
  s=$(git rev-parse HEAD && git diff HEAD && git ls-files -o --exclude-standard \
    && git ls-files -o --exclude-standard -z | xargs -0 git hash-object -- \
    && find playground/generated test/fixtures/generated node_modules/.modules.yaml \
      node_modules/.pnpm/lock.yaml -type f -print0 2>/dev/null | sort -z | xargs -0 shasum) || return 0
  printf '%s' "$s" | shasum | cut -d' ' -f1
}
cache="$(git rev-parse --absolute-git-dir)/claude-stop-check"
before=$(state)
if [ -z "$before" ] || [ "$(cat "$cache" 2>/dev/null)" != "$before" ]; then
  # pnpm re-syncs pnpm-lock.yaml and node_modules before a script when
  # package.json dependencies differ; fail instead so the hook never edits the tree.
  # STOP_CHECK_CMD lets stop-check.test.sh stub the checks.
  if out=$(pnpm_config_verify_deps_before_run=error sh -c "${STOP_CHECK_CMD:-mise run check:fast}" 2>&1); then
    # Record green only for the state the checks saw: a change during the run
    # (another tool, a second session in this worktree) leaves the cache alone.
    after=$(state)
    if [ -n "$before" ] && [ "$after" = "$before" ]; then
      tmp=$(mktemp "$cache.XXXXXX") && printf '%s' "$after" > "$tmp" && mv -f "$tmp" "$cache"
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
