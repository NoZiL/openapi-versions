#!/bin/sh
# PreToolUse (Edit|Write|MultiEdit): deny edits to generated output and patches/
# (AGENTS.md rules 1 and 7), in the session's checkout and in any other worktree of
# this repository (Orca worktrees). Exit 2 + stderr blocks the call and tells the model why.
project=${CLAUDE_PROJECT_DIR:-$(pwd)}
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -n "$file" ] || exit 0
# A relative file_path is relative to the session's cwd (hook input), not to this
# process's (mise starts the task in the directory of mise.toml); with no or an
# empty cwd, fall back to the process cwd.
case "$file" in
  /*) ;;
  *) cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
     file="${cwd:-.}/$file" ;;
esac
# Absolute, with (..) normalized so "src/../patches/x" can't slip through.
file=$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$file")

check() {
  case "$1" in
    playground/generated|playground/generated/*|test/fixtures/generated|test/fixtures/generated/*)
      echo "Blocked: $file is generated (AGENTS.md rule 1). Change the spec or openapi-versions.config.json, then run 'pnpm codegen'." >&2
      exit 2 ;;
    patches|patches/*)
      echo "Blocked: $file is under patches/, which must stay as is (AGENTS.md rule 7). Drop the patch only once openapi-ts/openapi-typescript#2766 ships, in a dedicated issue." >&2
      exit 2 ;;
  esac
}

# Relative to the session's checkout: works even without git.
check "$(node -e 'const p=require("path");process.stdout.write(p.relative(p.resolve(process.argv[1]),process.argv[2]))' "$project" "$file")"

# Relative to the top level of the worktree holding the file. A Write may create the
# file and its directories: ask git from the nearest existing ancestor and append the rest.
dir=$(dirname "$file")
rest=$(basename "$file")
while [ ! -d "$dir" ]; do
  rest="$(basename "$dir")/$rest"
  dir=$(dirname "$dir")
done
. "$(dirname "$0")/repo.sh"
repo_same "$dir" "$project" || exit 0
# --show-prefix resolves symlinks, so a path through a link to a worktree still matches.
prefix=$(git -C "$dir" rev-parse --show-prefix 2>/dev/null) || exit 0
check "$prefix$rest"
exit 0
