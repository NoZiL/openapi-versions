#!/bin/sh
# Tests for stop-check.sh's green-run cache (ADR 0015), in a throwaway repo
# with `mise` replaced by a stub on PATH. Run: sh .claude/hooks/stop-check.test.sh
set -eu
# Isolate from the caller's git config and repo, and from the Claude session's project.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY CLAUDE_PROJECT_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
hook="$(cd "$(dirname "$0")" && pwd)/stop-check.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo" count="$tmp/count"
mkdir "$repo"
cd "$repo"
git init -q -b main
git config user.email test@example.com
git config user.name test
printf 'node_modules/\nplayground/generated/\ntest/fixtures/generated/\n' > .gitignore
git add .gitignore
git commit -qm init
git checkout -qb work
echo change > work.txt # the hook does nothing on a branch with no changes
mkdir -p playground/generated test/fixtures/generated node_modules/.pnpm
echo gen > playground/generated/a.ts
echo gen > test/fixtures/generated/b.ts
echo lock > node_modules/.pnpm/lock.yaml

# The stub counts runs, runs $DURING (a change made while the checks run) and
# exits with $CHECK_RC. Export and unset them: `VAR=x func` leaks VAR in POSIX sh.
mkdir "$tmp/bin"
cat > "$tmp/bin/mise" <<'EOF'
#!/bin/sh
[ "$*" = "run check:fast" ] || { echo "unexpected: mise $*" >&2; exit 2; }
echo run >> "$COUNT"
[ -z "${DURING:-}" ] || sh -c "$DURING"
exit "${CHECK_RC:-0}"
EOF
chmod +x "$tmp/bin/mise"
export PATH="$tmp/bin:$PATH" COUNT="$count"
: > "$count"

fails=0
runs() { wc -l < "$count" | tr -d ' '; }
# expect <ran|skipped> <name>: run the hook once and check whether the checks ran.
expect() {
  n=$(runs)
  echo '{}' | sh "$hook" > /dev/null
  [ "$(runs)" -gt "$n" ] && got=ran || got=skipped
  if [ "$got" = "$1" ]; then echo "ok   $2"; else echo "FAIL $2: expected $1, got $got"; fails=$((fails + 1)); fi
}

expect ran "first run"
expect skipped "hit: nothing changed"

echo gen2 > playground/generated/a.ts
expect ran "miss: generated file changed"
expect skipped "hit after the generated change"

rm -rf test/fixtures/generated
expect ran "miss: generated dir deleted"

echo lock2 > node_modules/.pnpm/lock.yaml
expect ran "miss: pnpm install changed node_modules"

rm -rf node_modules
expect ran "miss: node_modules deleted"

# A change during the run: the checks may have seen either state, so neither is
# recorded as green, even once the tree is back to the state hashed before the run.
echo edit >> work.txt
cp work.txt "$tmp/before"
export DURING="echo during >> $repo/work.txt"
expect ran "change during the run: checks run"
unset DURING
cp "$tmp/before" work.txt
expect ran "change during the run: state before it not recorded as green"
expect skipped "hit once a run saw the state unchanged"

echo edit >> work.txt
cp playground/generated/a.ts "$tmp/before"
export DURING="echo during > $repo/playground/generated/a.ts"
expect ran "generated dir changed during the run: checks run"
unset DURING
cp "$tmp/before" playground/generated/a.ts
expect ran "generated dir changed during the run: not recorded as green"

echo red >> work.txt
export CHECK_RC=1
expect ran "red run"
unset CHECK_RC
expect ran "red run is not cached"

n=$(runs)
echo '{"stop_hook_active":true}' | sh "$hook" > /dev/null
[ "$(runs)" = "$n" ] && echo "ok   stop_hook_active skips" || { echo "FAIL stop_hook_active ran the checks"; fails=$((fails + 1)); }

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
