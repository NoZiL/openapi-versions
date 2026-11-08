#!/bin/sh
# UserPromptSubmit: tell the model when the session has grown past the
# thresholds in AGENTS.md "Session scope". Fires once per level per session.
CTX_WARN=70
CTX_HIGH=85
COMMITS_WARN=5

input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty')
[ -n "$sid" ] || exit 0
tmp=${TMPDIR:-/tmp}

pct=$(cat "$tmp/claude-ctx-$sid" 2>/dev/null)
pct=${pct:-0}
base=origin/main
git rev-parse --verify -q "$base" >/dev/null || base=main
commits=$(git rev-list --count "$base..HEAD" 2>/dev/null || echo 0)

level=0
if [ "$pct" -ge "$CTX_HIGH" ]; then level=2
elif [ "$pct" -ge "$CTX_WARN" ] || [ "$commits" -ge "$COMMITS_WARN" ]; then level=1
fi

seen=$(cat "$tmp/claude-nudge-$sid" 2>/dev/null)
seen=${seen:-0}
[ "$level" -gt "$seen" ] || exit 0
printf '%s' "$level" > "$tmp/claude-nudge-$sid"

msg="Session check: context window is at ${pct}% and the branch is ${commits} commits ahead of ${base}. AGENTS.md (Session scope) asks for one issue per session and per PR. If the current task is done or the context is heavy, the user can run /wrap-up and start a fresh session; mention this to them."
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$m}}'
