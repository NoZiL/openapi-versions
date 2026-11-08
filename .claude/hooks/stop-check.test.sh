#!/bin/sh
# Tests for stop-check.sh's green-run cache (ADR 0015), in a throwaway repo
# with `mise` replaced by a stub on PATH. Run: sh .claude/hooks/stop-check.test.sh
set -eu
# Isolate from the caller's git config and repo, and from the Claude session's project.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY CLAUDE_PROJECT_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
hook="$(cd "$(dirname "$0")" && pwd)/stop-check.sh"
root="$(cd "$(dirname "$0")/../.." && pwd)"
fails=0

# The cache assumes check:fast regenerates both generated dirs before typecheck and
# test read them, and that typecheck and test run no codegen of their own (ADRs
# 0015, 0020): that holds only through these mise depends and run lines. Checked
# against the real mise.toml, before the stub replaces mise.
tasks=$(mise -C "$root" tasks ls --json 2>/dev/null \
  | jq -r '.[] | "\(.name) depends=\(.depends // [] | sort | join(",")) run=\(.run // [] | join(";"))"' 2>/dev/null) || tasks=""
# want_task <task> <expected "depends=... run=..." line>
want_task() {
  got=$(printf '%s\n' "$tasks" | grep "^$1 " || true)
  if [ "$got" = "$1 $2" ]; then echo "ok   mise $1: $2"
  else echo "FAIL mise $1: got '${got#"$1 "}', expected '$2'"; fails=$((fails + 1)); fi
}
want_task check:fast "depends=lint,test,typecheck run="
want_task typecheck "depends=codegen run=pnpm typecheck:tsc"
want_task codegen "depends=codegen:playground,codegen:test run="
want_task test "depends=codegen:test run=pnpm test:run"

tmp=$(mktemp -d)
trap 'chmod -R u+rwx "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
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
echo "MISE_LOCKED=${MISE_LOCKED:-} verify=${pnpm_config_verify_deps_before_run:-}" > "$COUNT.env"
[ -z "${DURING:-}" ] || sh -c "$DURING"
[ -z "${OUT:-}" ] || printf '%s\n' "$OUT"
exit "${CHECK_RC:-0}"
EOF
chmod +x "$tmp/bin/mise"
export PATH="$tmp/bin:$PATH" COUNT="$count"
: > "$count"

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

# The checks regenerate the generated dirs: the key takes them as the run left them.
echo edit >> work.txt
export DURING="echo regenerated > $repo/playground/generated/a.ts"
expect ran "generated dir rewritten by the run: checks run"
unset DURING
expect skipped "generated dir rewritten by the run: hit on the next stop"

mkdir -p sub
echo edit >> work.txt
expect ran "change, then a stop from a subdirectory"
n=$(runs)
(cd sub && echo '{}' | sh "$hook" > /dev/null)
[ "$(runs)" = "$n" ] && echo "ok   hit from a subdirectory" || { echo "FAIL subdirectory missed the cache"; fails=$((fails + 1)); }

echo new > untracked.txt
expect ran "miss: untracked file added"

echo red >> work.txt
export CHECK_RC=1
expect ran "red run"
unset CHECK_RC
expect ran "red run is not cached"

# Neither pnpm nor mise may edit the tree during the checks (ADRs 0014, 0022).
[ "$(cat "$count.env")" = "MISE_LOCKED=true verify=error" ] && echo "ok   checks run with MISE_LOCKED and verify-deps=error" \
  || { echo "FAIL checks env: $(cat "$count.env")"; fails=$((fails + 1)); }

# A red run's reason gets a hint for the two install errors, and none otherwise.
# hint <name> <mise output> <expected text in the reason, or "none">
hint() {
  echo edit >> work.txt
  export CHECK_RC=1 OUT="$2"
  echo '{}' | sh "$hook" > "$tmp/out"
  unset CHECK_RC OUT
  r=$(jq -r .reason "$tmp/out")
  case "$3" in
    none) printf '%s' "$r" | grep -q '^mise run check:fast failed' && ! printf '%s' "$r" | grep -qE 'run (pnpm|mise) install' ;;
    *) printf '%s' "$r" | grep -qF "$3" ;;
  esac && echo "ok   hint: $1" || { echo "FAIL hint: $1: $r"; fails=$((fails + 1)); }
}
hint "pnpm deps out of date" " ERR_PNPM_VERIFY_DEPS_BEFORE_RUN  Cannot run" "no node_modules, or package.json, pnpm-lock.yaml or pnpm-workspace.yaml changed since the last install): run pnpm install."
hint "tool not in mise.lock" "mise WARN  Failed to resolve tool version list for actionlint: [--runtime] actionlint@1.7.11: actionlint@1.7.11 is not in the lockfile" "mise could not install a tool from mise.lock"
hint "other failure" "error TS2322" none

# The hook works in the hook input's cwd, not the process cwd.
echo edit >> work.txt
n=$(runs)
(cd "$tmp" && printf '{"cwd":"%s"}' "$repo" | sh "$hook" > /dev/null)
[ "$(runs)" -gt "$n" ] && echo "ok   input cwd: checks run in that repo" || { echo "FAIL input cwd: checks did not run"; fails=$((fails + 1)); }
(cd "$tmp" && printf '{"cwd":"%s"}' "$repo" | sh "$hook" > /dev/null)
[ "$(runs)" -gt "$((n + 1))" ] && { echo "FAIL input cwd: missed the cache"; fails=$((fails + 1)); } || echo "ok   input cwd: hit"

# A cwd outside any work tree (a plain directory, a .git dir, a removed directory): exit 0 quietly, no checks.
echo edit >> work.txt
mkdir "$tmp/outside"
# An empty cwd must not fall back to the process cwd ($repo here).
for dir in "$tmp/outside" "$repo/.git" "$tmp/missing" ""; do
  label=$(basename "${dir:-empty}")
  n=$(runs)
  rc=0
  (cd "$repo" && printf '{"cwd":"%s"}' "$dir" | sh "$hook" > "$tmp/out" 2> "$tmp/err") || rc=$?
  if [ "$rc" = 0 ] && [ "$(runs)" = "$n" ] && [ ! -s "$tmp/out" ] && [ ! -s "$tmp/err" ]; then
    echo "ok   cwd not in a work tree ($label): exits quietly"
  else
    echo "FAIL cwd not in a work tree ($label): rc=$rc, stdout=$(cat "$tmp/out"), stderr=$(cat "$tmp/err")"
    fails=$((fails + 1))
  fi
done

# find fails partway (here an unreadable dir): the hash fails, so never hit, never write.
if [ "$(id -u)" -ne 0 ]; then
  mkdir playground/generated/locked
  echo gen > playground/generated/locked/c.ts
  chmod 000 playground/generated/locked
  expect ran "find fails partway: checks run"
  expect ran "find fails partway: never hit, never written"
  chmod 755 playground/generated/locked
  expect ran "readable again: checks run"
  expect skipped "readable again: hit"
else
  echo "skip find fails partway (root ignores permissions)"
fi

# Invalid hook input: exit 0 quietly, no jq parse errors on stderr, no checks.
echo edit >> work.txt
n=$(runs)
rc=0
echo 'not json' | sh "$hook" > "$tmp/out" 2> "$tmp/err" || rc=$?
if [ "$rc" = 0 ] && [ "$(runs)" = "$n" ] && [ ! -s "$tmp/out" ] && [ ! -s "$tmp/err" ]; then echo "ok   invalid input: exits quietly"
else echo "FAIL invalid input: rc=$rc, stdout=$(cat "$tmp/out"), stderr=$(cat "$tmp/err")"; fails=$((fails + 1)); fi

# No jq on PATH: a non-blocking error that says why, no checks.
n=$(runs)
mkdir "$tmp/empty"
rc=0
echo '{}' | PATH="$tmp/empty" /bin/sh "$hook" > "$tmp/out" 2> "$tmp/err" || rc=$?
if [ "$rc" = 1 ] && [ "$(runs)" = "$n" ] && grep -q 'jq not found' "$tmp/err"; then echo "ok   no jq: says so, exit 1"
else echo "FAIL no jq: rc=$rc, stderr=$(cat "$tmp/err")"; fails=$((fails + 1)); fi

n=$(runs)
echo '{"stop_hook_active":true}' | sh "$hook" > /dev/null
[ "$(runs)" = "$n" ] && echo "ok   stop_hook_active skips" || { echo "FAIL stop_hook_active ran the checks"; fails=$((fails + 1)); }

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
