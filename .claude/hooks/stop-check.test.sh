#!/bin/sh
# Tests for stop-check.sh's green-run cache (ADR 0015) and ADR block (ADR 0024), in a throwaway repo
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
err=$(mktemp)
tasks=$(mise -C "$root" tasks ls --json 2> "$err" \
  | jq -r '.[] | "\(.name) depends=\(.depends // [] | sort | join(",")) run=\(.run // [] | join(";"))"' 2>> "$err") || tasks=""
msg=$(cat "$err")
rm -f "$err"
# want_task <task> <expected "depends=... run=..." line>
want_task() {
  got=$(printf '%s\n' "$tasks" | grep "^$1 " || true)
  if [ "$got" = "$1 $2" ]; then echo "ok   mise $1: $2"
  else echo "FAIL mise $1: got '${got#"$1 "}', expected '$2'"; fails=$((fails + 1)); fi
}
if [ -z "$tasks" ]; then
  echo "FAIL mise tasks ls gave nothing (is mise installed and $root/mise.toml trusted?): $msg"
  fails=$((fails + 1))
else
  want_task check:fast "depends=lint,test,typecheck run="
  want_task typecheck "depends=codegen run=pnpm typecheck:tsc"
  want_task codegen "depends=codegen:playground,codegen:test run="
  want_task test "depends=codegen:test run=pnpm test:run"
fi

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
# `mise ls --no-global --missing` prints $MISSING (missing project tools).
[ "$*" = "ls --no-global --missing" ] && { [ -z "${MISSING:-}" ] || printf '%s\n' "$MISSING"; exit 0; }
[ "$*" = "run check:fast" ] || { echo "unexpected: mise $*" >&2; exit 2; }
echo run >> "$COUNT"
echo "auto-install=${MISE_AUTO_INSTALL:-} verify=${pnpm_config_verify_deps_before_run:-}" > "$COUNT.env"
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
[ "$(cat "$count.env")" = "auto-install=false verify=error" ] && echo "ok   checks run with mise auto-install off and verify-deps=error" \
  || { echo "FAIL checks env: $(cat "$count.env")"; fails=$((fails + 1)); }

# A red run's reason gets a hint for the two install errors, and none otherwise.
# hint <name> <mise output> <missing tools> <expected text in the reason, or "none">
hint() {
  echo edit >> work.txt
  export CHECK_RC=1 OUT="$2" MISSING="$3"
  echo '{}' | sh "$hook" > "$tmp/out"
  unset CHECK_RC OUT MISSING
  r=$(jq -r .reason "$tmp/out")
  case "$4" in
    none) printf '%s' "$r" | grep -q '^mise run check:fast failed' && ! printf '%s' "$r" | grep -qE 'run (pnpm|mise) install' ;;
    *) printf '%s' "$r" | grep -qF "$4" ;;
  esac && echo "ok   hint: $1" || { echo "FAIL hint: $1: $r"; fails=$((fails + 1)); }
}
hint "pnpm deps out of date" " ERR_PNPM_VERIFY_DEPS_BEFORE_RUN  Cannot run" "" "no node_modules, or package.json, pnpm-lock.yaml or pnpm-workspace.yaml changed since the last install): run pnpm install."
hint "other failure" "error TS2322" "" none
# A lockfile warning about a global tool is not a project tool missing.
hint "global tool warning only" "mise WARN  lefthook@2.1.10 is not in the lockfile
error TS2322" "" none

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

# A project tool not installed: block before the checks run, and never cache, even
# though the checks would pass on whatever else is on PATH.
echo edit >> work.txt
n=$(runs)
export MISSING="node  27.0.0 (missing)  /repo/mise.toml  27
actionlint  1.7.10 (missing)  /repo/mise.toml  1.7.10"
echo '{}' | sh "$hook" > "$tmp/out"
unset MISSING
r=$(jq -r .reason "$tmp/out" 2>/dev/null)
if [ "$(runs)" = "$n" ] && printf '%s' "$r" | grep -qF 'not installed: node@27.0.0, actionlint@1.7.10. Run mise install'; then
  echo "ok   missing project tool: blocks before the checks"
else echo "FAIL missing project tool: runs $n -> $(runs), reason: $r"; fails=$((fails + 1)); fi
expect ran "missing project tool: nothing cached, checks run once installed"

# No jq on PATH (everything else kept): a non-blocking error that says why, no
# checks, and the hook still reads all of stdin first. The writer waits so the hook
# would have exited already if it did not read, and ignores SIGPIPE to see EPIPE.
mkdir "$tmp/nojq"
IFS=:
for d in $PATH; do
  [ -d "$d" ] || continue
  for f in "$d"/*; do
    b=${f##*/}
    [ "$b" = jq ] || [ -e "$tmp/nojq/$b" ] || [ ! -x "$f" ] || ln -s "$f" "$tmp/nojq/$b"
  done
done
unset IFS
n=$(runs)
rc=0
rm -f "$tmp/epipe"
(trap '' PIPE; sleep 1; printf '{}' || echo epipe > "$tmp/epipe") \
  | PATH="$tmp/nojq" /bin/sh "$hook" > "$tmp/out" 2> "$tmp/err" || rc=$?
if [ "$rc" = 1 ] && [ "$(runs)" = "$n" ] && grep -q 'jq not found' "$tmp/err" && [ ! -e "$tmp/epipe" ]; then
  echo "ok   no jq: reads stdin, says so, exit 1"
else echo "FAIL no jq: rc=$rc, epipe=$([ -e "$tmp/epipe" ] && echo yes || echo no), stderr=$(cat "$tmp/err")"; fails=$((fails + 1)); fi

# The missing-ADR block is raised once per branch and policy content (ADR 0024).
# adr <raised|quiet> <name>: run the hook once and check for the ADR reason.
adr() {
  printf '{"session_id":"%s"}' "${SESSION:-s1}" | sh "$hook" > "$tmp/out"
  jq -r '.reason // empty' "$tmp/out" 2>/dev/null | grep -q '^Policy files changed with no ADR' && got=raised || got=quiet
  if [ "$got" = "$1" ]; then echo "ok   adr: $2"; else echo "FAIL adr: $2: expected $1, got $got"; fails=$((fails + 1)); fi
}
echo '{}' > biome.json
adr raised "policy file added without an ADR"
adr quiet "same policy content: not raised again"
echo edit >> work.txt
adr quiet "non-policy change: not raised again"
echo '{"a":1}' > biome.json
adr raised "policy file changed again: raised"
adr quiet "then quiet"
git add biome.json && git commit -qm biome
adr quiet "committing the same content: not raised again"
git checkout -qb work2
adr quiet "another branch, same content and session: not raised"
export SESSION=s2
adr raised "another session: raised"
adr quiet "then quiet in that session"
unset SESSION
mkdir -p docs/adr && echo adr > docs/adr/0001-x.md
echo '{"a":2}' > biome.json
adr quiet "an ADR on the branch: never raised"
rm -rf docs/adr
adr raised "ADR removed: raised for the current content"
echo '{"a":3}' > biome.json
adr raised "edited again: raised"
echo '{"a":2}' > biome.json
adr quiet "reverted to an answered state: not raised again"
git checkout -q work && git checkout -q work2
adr quiet "branch switched and back: not raised again"
rm biome.json
adr quiet "policy file back to the base (absent): nothing to ask"
git checkout -q biome.json
echo '{"name":"x","dependencies":{"a":"1"}}' > package.json && git add package.json && git commit -qm pkg
git checkout -qb work3
adr raised "branch with a different policy diff: raised"
adr quiet "then quiet"
echo '{"name":"x","dependencies":{"a":"2"}}' > package.json
adr raised "dependency changed: raised"
adr quiet "then quiet"
echo '{"name":"y","dependencies":{"a":"2"}}' > package.json
adr quiet "non-dependency change in package.json: not raised"
# Blocked together with red checks: not recorded, so asked again.
echo '{"a":4}' > biome.json
export CHECK_RC=1
adr raised "with red checks: raised"
unset CHECK_RC
adr raised "after a block with red checks: raised again"
adr quiet "then quiet"

n=$(runs)
echo '{"stop_hook_active":true}' | sh "$hook" > /dev/null
[ "$(runs)" = "$n" ] && echo "ok   stop_hook_active skips" || { echo "FAIL stop_hook_active ran the checks"; fails=$((fails + 1)); }

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
