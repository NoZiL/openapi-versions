#!/bin/sh
# PreToolUse (Edit|Write|MultiEdit): deny edits to generated output and patches/
# (AGENTS.md rules 1 and 7). Exit 2 + stderr blocks the call and tells the model why.
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] || exit 0
# Normalize (..) so "src/../patches/x" can't slip through.
rel=$(node -e 'const p=require("path");process.stdout.write(p.relative(p.resolve(process.argv[1]),p.resolve(process.argv[1],process.argv[2])))' "$root" "$file")
case "$rel" in
  playground/generated|playground/generated/*|test/fixtures/generated|test/fixtures/generated/*)
    echo "Blocked: $rel is generated (AGENTS.md rule 1). Change the spec or openapi-versions.config.json, then run 'pnpm codegen'." >&2
    exit 2 ;;
  patches|patches/*)
    echo "Blocked: patches/ must stay as is (AGENTS.md rule 7). Drop the patch only once openapi-ts/openapi-typescript#2766 ships, in a dedicated issue." >&2
    exit 2 ;;
esac
exit 0
