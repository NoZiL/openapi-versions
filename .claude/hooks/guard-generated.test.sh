#!/bin/sh
# Tests for guard-generated.sh: edits to generated dirs and patches/ are blocked in the
# session's checkout and in other worktrees of the repository. Run: sh .claude/hooks/guard-generated.test.sh
set -eu
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
hook="$(cd "$(dirname "$0")" && pwd)/guard-generated.sh"
tmp=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$tmp"' EXIT

newrepo() {
  git init -q -b main "$1"
  git -C "$1" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m init
}
newrepo "$tmp/main"
git -C "$tmp/main" worktree add -q "$tmp/wt" -b wt
newrepo "$tmp/other"
for d in main wt other; do mkdir -p "$tmp/$d/playground/generated/v1" "$tmp/$d/patches" "$tmp/$d/src"; done
mkdir -p "$tmp/plain/playground/generated"
ln -s "$tmp/wt" "$tmp/link"
export CLAUDE_PROJECT_DIR="$tmp/main"

fails=0
# expect <rc> <file_path> <name>: file_path sent as is, with hook input cwd $CWD
# (default $tmp/main); the hook process starts in $tmp/main, as mise starts it.
expect() {
  rc=0
  json=$(printf '{"cwd":"%s","tool_input":{"file_path":"%s"}}' "${CWD-$tmp/main}" "$2")
  (cd "$tmp/main" && printf '%s' "$json" | sh "$hook" 2> "$tmp/err") || rc=$?
  if [ "$rc" = "$1" ]; then echo "ok   $3"
  else echo "FAIL $3: rc=$rc, stderr: $(cat "$tmp/err")"; fails=$((fails + 1)); fi
}

expect 2 "$tmp/main/playground/generated/v1/client.ts" "generated file in the session's checkout"
expect 2 "$tmp/main/test/fixtures/generated/v1/client.ts" "new generated dir in the session's checkout"
expect 2 "$tmp/main/patches/x.patch" "patches/ in the session's checkout"
expect 2 "$tmp/main/src/../patches/x.patch" "(..) normalized"
expect 2 "playground/generated/v1/client.ts" "relative file_path"
CWD="$tmp/main/src" expect 2 "../patches/x.patch" "relative file_path: resolved against the hook input cwd"
expect 0 "$tmp/main/src/a.ts" "source file in the session's checkout: allowed"
expect 2 "$tmp/wt/playground/generated/v1/client.ts" "generated file in another worktree"
expect 2 "$tmp/wt/test/fixtures/generated/v9/new/client.ts" "new generated dirs in another worktree"
expect 2 "$tmp/wt/patches/x.patch" "patches/ in another worktree"
expect 2 "$tmp/link/playground/generated/v1/client.ts" "another worktree through a symlink"
expect 0 "$tmp/wt/src/a.ts" "source file in another worktree: allowed"
expect 0 "$tmp/other/playground/generated/v1/client.ts" "another repository: allowed"
expect 0 "$tmp/plain/playground/generated/x.ts" "outside any repository: allowed"
expect 0 "$tmp/main/playground/generated-notes.md" "name that only starts like a generated dir: allowed"
grep -q . "$tmp/err" && { echo "FAIL allowed edit wrote to stderr: $(cat "$tmp/err")"; fails=$((fails + 1)); } || echo "ok   allowed edit: silent"
expect 2 "$tmp/wt/patches/x.patch" "blocked edit: message"
grep -q 'AGENTS.md rule 7' "$tmp/err" && echo "ok   blocked edit: names the rule" || { echo "FAIL blocked edit: no rule in message"; fails=$((fails + 1)); }

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
