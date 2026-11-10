#!/bin/sh
# PostToolUse (Edit|Write|MultiEdit): safe Biome fixes on the changed file, then
# report what remains. Never --unsafe. Files Biome ignores (see biome.json) are skipped.
project=${CLAUDE_PROJECT_DIR:-$(pwd)}
input=$(cat)
. "$(dirname "$0")/repo.sh"
file=$(hook_file "$input")
[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0
# Run Biome from the top level of the worktree holding the file, which may not be
# the session's (Orca worktrees): Biome panics on a path outside its root.
# Skip files outside any worktree of this repository.
dir=$(dirname "$file")
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) && [ -n "$root" ] || exit 0
# Pass Biome a path relative to that top level: always under its root, even when
# the absolute path goes through a symlink (git resolves it). The ./ keeps a
# name starting with - a path for any tool (Biome 2.6 already accepts one).
prefix=$(git -C "$dir" rev-parse --show-prefix 2>/dev/null) || exit 0
rel="./$prefix$(basename "$file")"
# A project dir outside any repository would skip every file. Say so on stderr
# (exit 0: Claude Code shows it in the transcript view only).
pc=$(repo_common "$project") && [ -n "$pc" ] || {
  echo "biome-fix: skipped $file: project dir $project is not in a git repository" >&2
  exit 0
}
c=$(repo_common "$dir") && [ -n "$c" ] && [ "$c" = "$pc" ] || exit 0
cd "$root" || exit 0
# A worktree without `pnpm install` has no Biome: skip rather than report a lint failure.
[ -x node_modules/.bin/biome ] || exit 0
flags="--no-errors-on-unmatched --files-ignore-unknown=true --colors=off"
# Fixes cascade (organizeImports then formatting) and Biome needs two passes to converge;
# then a plain check reports what is left.
# The binary directly: pnpm exec would start pnpm three times per edit.
node_modules/.bin/biome check --write $flags "$rel" >/dev/null 2>&1
node_modules/.bin/biome check --write $flags "$rel" >/dev/null 2>&1
out=$(node_modules/.bin/biome check $flags "$rel" 2>&1) && exit 0
printf 'Biome found problems in %s that need a manual fix:\n%s\n' "$file" "$out" >&2
exit 2
