#!/bin/sh
# PostToolUse (Edit|Write|MultiEdit): safe Biome fixes on the changed file, then
# report what remains. Never --unsafe. Files Biome ignores (see biome.json) are skipped.
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0
cd "$root" || exit 0
flags="--no-errors-on-unmatched --files-ignore-unknown=true --colors=off"
# Fixes cascade (organizeImports then formatting) and Biome needs two passes to converge;
# then a plain check reports what is left.
pnpm exec biome check --write $flags "$file" >/dev/null 2>&1
pnpm exec biome check --write $flags "$file" >/dev/null 2>&1
out=$(pnpm exec biome check $flags "$file" 2>&1) && exit 0
printf 'Biome found problems in %s that need a manual fix:\n%s\n' "$file" "$out" >&2
exit 2
