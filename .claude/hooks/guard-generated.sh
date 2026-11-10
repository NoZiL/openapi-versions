#!/bin/sh
# PreToolUse (Edit|Write|MultiEdit): deny edits to generated output and patches/
# (AGENTS.md rules 1 and 7), in the session's checkout and in any other worktree of
# this repository (Orca worktrees). Exit 2 + stderr blocks the call and tells the model why.
project=${CLAUDE_PROJECT_DIR:-$(pwd)}
input=$(cat)
. "$(dirname "$0")/repo.sh"
file=$(hook_file "$input")
[ -n "$file" ] || exit 0
# One node start prints two lines: the absolute path, with (..) normalized so
# "src/../patches/x" can't slip through and resolved through symlinks when it exists
# (a link to a patch is an edit to the patch); then that path relative to the project dir.
paths=$(node -e '
const p = require("path"), fs = require("fs");
const real = (x) => { try { return fs.realpathSync(x); } catch { return p.resolve(x); } };
const f = real(process.argv[2]);
process.stdout.write(f + "\n" + p.relative(real(process.argv[1]), f));
' "$project" "$file") || exit 0
file=$(printf '%s\n' "$paths" | sed -n 1p)
rel=$(printf '%s\n' "$paths" | sed -n 2p)

check() {
  # Lowercase: on a case-insensitive file system (macOS) Playground/Generated is the same dir.
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    playground/generated|playground/generated/*|test/fixtures/generated|test/fixtures/generated/*)
      echo "Blocked: $file is generated (AGENTS.md rule 1). Change the spec or openapi-versions.config.json, then run 'pnpm codegen'." >&2
      exit 2 ;;
    patches|patches/*)
      echo "Blocked: $file is under patches/, which must stay as is (AGENTS.md rule 7). Drop the patch only once openapi-ts/openapi-typescript#2766 ships, in a dedicated issue." >&2
      exit 2 ;;
  esac
}

# Relative to the session's checkout: works even without git.
check "$rel"

# Relative to the top level of the worktree holding the file. A Write may create the
# file and its directories: ask git from the nearest existing ancestor and append the rest.
dir=$(dirname "$file")
rest=$(basename "$file")
while [ ! -d "$dir" ]; do
  rest="$(basename "$dir")/$rest"
  dir=$(dirname "$dir")
done
c=$(repo_common "$dir") && [ -n "$c" ] && pc=$(repo_common "$project") && [ "$c" = "$pc" ] || exit 0
prefix=$(git -C "$dir" rev-parse --show-prefix 2>/dev/null) || exit 0
check "$prefix$rest"
exit 0
