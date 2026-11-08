#!/bin/sh
# Tests for biome-fix.sh: Biome runs from the top level of the worktree holding the
# edited file, with `node_modules/.bin/biome` replaced by a stub. Run: sh .claude/hooks/biome-fix.test.sh
set -eu
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
hook="$(cd "$(dirname "$0")" && pwd)/biome-fix.sh"
tmp=$(cd "$(mktemp -d)" && pwd -P) # resolved, so paths compare with `pwd -P`
trap 'rm -rf "$tmp"' EXIT
log="$tmp/log"

newrepo() {
  git init -q -b main "$1"
  git -C "$1" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m init
}
newrepo "$tmp/main"
git -C "$tmp/main" worktree add -q "$tmp/wt" -b wt
newrepo "$tmp/other"
mkdir -p "$tmp/main/src" "$tmp/wt/src" "$tmp/plain"
mkdir -p "$tmp/main/node_modules/.bin" "$tmp/wt/node_modules/.bin"
git -C "$tmp/main" worktree add -q "$tmp/bare" -b bare # no node_modules
ln -s "$tmp/wt" "$tmp/link"
for f in bare/f.ts main/-dash.ts main/a.ts main/src/b.ts wt/src/c.ts other/d.ts plain/e.ts; do echo x > "$tmp/$f"; done

# The node_modules/.bin/biome stub logs "<cwd> <file>" for each call and, like
# Biome, fails on a path outside its cwd. $BIOME_RC makes the final plain check
# fail. The hook calls the binary directly: a pnpm on PATH must not run.
cat > "$tmp/main/node_modules/.bin/biome" <<'STUB'
#!/bin/sh
for f; do :; done
echo "$(pwd -P) $f" >> "$LOG"
case "$f" in /* | ../* | */../*) echo "path is expected to be under the root" >&2; exit 1 ;; esac
[ -f "$f" ] || { echo "no such file: $f" >&2; exit 1; }
case "$*" in *--write*) ;; *) exit "${BIOME_RC:-0}" ;; esac
STUB
chmod +x "$tmp/main/node_modules/.bin/biome"
cp "$tmp/main/node_modules/.bin/biome" "$tmp/wt/node_modules/.bin/biome"
mkdir "$tmp/bin"
printf '#!/bin/sh\necho "pnpm $*" >> "$LOG"\nexit 1\n' > "$tmp/bin/pnpm"
chmod +x "$tmp/bin/pnpm"
export PATH="$tmp/bin:$PATH" LOG="$log" CLAUDE_PROJECT_DIR="$tmp/main"

fails=0
# expect <expected cwd, or "none"> <rc> <file_path> <name> [<path Biome gets>]
# file_path is sent as is, with hook input cwd $CWD (default $tmp/main, "none" to
# omit the key); the hook process always starts in $PROC (default $tmp/main), as
# mise starts it in the project's top level.
expect() {
  : > "$log"
  rc=0
  case "${CWD-$tmp/main}" in
    none) json=$(printf '{"tool_input":{"file_path":"%s"}}' "$3") ;;
    *) json=$(printf '{"cwd":"%s","tool_input":{"file_path":"%s"}}' "${CWD-$tmp/main}" "$3") ;;
  esac
  (cd "${PROC:-$tmp/main}" && printf '%s' "$json" | sh "$hook" 2> "$tmp/err") || rc=$?
  if [ "$1" = none ]; then want=""; else want=$(printf '%s %s\n' "$1" "$5" "$1" "$5" "$1" "$5"); fi
  if [ "$(cat "$log")" = "$want" ] && [ "$rc" = "$2" ]; then echo "ok   $4"
  else echo "FAIL $4: rc=$rc, calls: $(cat "$log"), stderr: $(cat "$tmp/err")"; fails=$((fails + 1)); fi
}

expect "$tmp/main" 0 "$tmp/main/a.ts" "file in the session's checkout" ./a.ts
expect "$tmp/main" 0 "$tmp/main/src/b.ts" "file in a subdirectory: runs from the top level" ./src/b.ts
expect "$tmp/main" 0 "src/b.ts" "relative file_path" ./src/b.ts
export CWD="$tmp/main/src"
expect "$tmp/main" 0 "b.ts" "relative file_path: resolved against the hook input cwd" ./src/b.ts
export CWD=none PROC="$tmp/main/src"
expect "$tmp/main" 0 "b.ts" "relative file_path, no cwd in the input: process cwd" ./src/b.ts
export CWD=""
expect "$tmp/main" 0 "b.ts" "relative file_path, empty cwd: process cwd" ./src/b.ts
unset CWD PROC
expect "$tmp/main" 0 "$tmp/main/-dash.ts" "file name starting with -: passed as a path" ./-dash.ts
expect "$tmp/wt" 0 "$tmp/wt/src/c.ts" "file in another worktree: runs from that worktree" ./src/c.ts
expect "$tmp/wt" 0 "$tmp/link/src/c.ts" "file through a symlink: path under the top level" ./src/c.ts
expect none 0 "$tmp/bare/f.ts" "worktree without Biome installed: skipped"
expect none 0 "$tmp/other/d.ts" "file in another repository: skipped"
expect none 0 "$tmp/plain/e.ts" "file outside any repository: skipped"
expect none 0 "$tmp/main/missing.ts" "deleted file: skipped"
# A project dir with no git common dir skips every file: the hook says so on stderr.
export CLAUDE_PROJECT_DIR="$tmp/plain"
expect none 0 "$tmp/main/a.ts" "project not a repository: skipped"
grep -q 'biome-fix: skipped' "$tmp/err" && echo "ok   project not a repository: said on stderr" || { echo "FAIL project not a repository: silent"; fails=$((fails + 1)); }
export CLAUDE_PROJECT_DIR="$tmp/main"
export BIOME_RC=1
expect "$tmp/wt" 2 "$tmp/wt/src/c.ts" "problems left: exit 2" ./src/c.ts
unset BIOME_RC
grep -q 'need a manual fix' "$tmp/err" && echo "ok   problems left: reported" || { echo "FAIL problems left: not reported"; fails=$((fails + 1)); }

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
