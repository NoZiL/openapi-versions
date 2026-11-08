#!/bin/sh
# Stop: block once if a policy file changed without an ADR, or if the tree is
# red (lint, typecheck, test), skipping the checks if the state is unchanged
# since the last green run. oasdiff and build stay CI-only (ADR 0004).
# stop_hook_active is true on the retry after a block, so we never loop.
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

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

# Skip the slow checks when nothing changed since the last green run.
# State = HEAD + tracked diff + untracked paths and contents.
cache="$(git rev-parse --git-dir)/claude-stop-check"
state=$( { git rev-parse HEAD; git diff HEAD; git ls-files -o --exclude-standard -z | xargs -0 git hash-object --stdin-paths 2>/dev/null; git ls-files -o --exclude-standard; } | shasum | cut -d' ' -f1)
if [ "$(cat "$cache" 2>/dev/null)" != "$state" ]; then
  if out=$(mise run check:fast 2>&1); then
    printf '%s' "$state" > "$cache"
  else
    reasons="${reasons:+$reasons

}mise run check:fast failed. Fix it before finishing:
$(printf '%s\n' "$out" | tail -40)"
  fi
fi

[ -n "$reasons" ] || exit 0
jq -n --arg r "$reasons" '{decision:"block",reason:$r}'
