#!/bin/sh
# Status line: context %, cost, branch. Also records context % per session
# so scope-nudge.sh (hooks do not receive context usage) can read it.
input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty')
pct=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty' | cut -d. -f1)
cost=$(printf '%s' "$input" | jq -r '.cost.total_cost_usd // 0')
branch=$(git branch --show-current 2>/dev/null)
if [ -n "$sid" ] && [ -n "$pct" ]; then
  printf '%s' "$pct" > "${TMPDIR:-/tmp}/claude-ctx-$sid" 2>/dev/null
fi
printf 'ctx %s%% | $%.2f | %s' "${pct:-?}" "$cost" "${branch:-detached}"
