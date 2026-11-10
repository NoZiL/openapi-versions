# Sourced by the Edit/Write hooks (not a hook itself): find the edited file in the
# hook input (hook_file), and tell whether a path is in a worktree of this repository,
# which may not be the session's (Orca worktrees): compare repo_common of its
# directory with repo_common of the project dir.

# repo_common <dir>: the git common dir of the worktree holding <dir>, absolute and
# resolved, from the top level (older git prints --git-common-dir relative to it;
# --path-format=absolute needs git 2.31). Fails outside any repository.
repo_common() {
  # No CDPATH: a relative .git must resolve against the top level only.
  (unset CDPATH; t=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) && [ -n "$t" ] && cd -P -- "$t" \
    && d=$(git rev-parse --git-common-dir 2>/dev/null) && [ -n "$d" ] && cd -P -- "$d" && pwd -P)
}

# hook_file <hook input JSON>: the edited file's .tool_input.file_path, or nothing.
# A relative file_path is relative to the session's cwd (hook input), not to this
# process's (mise starts the task in the directory of mise.toml); with no or an
# empty cwd, fall back to the process cwd.
hook_file() {
  printf '%s' "$1" | jq -r '(.cwd // "") as $c | .tool_input.file_path // empty | select(. != "")
    | if startswith("/") then . else (if $c == "" then "." else $c end) + "/" + . end'
}
