# 0024. The Stop hook raises the missing-ADR block once per policy change

- Status: accepted
- Date: 2026-11-09
- Amends: [0013](0013-stop-hook-adr-and-check.md) (the missing-ADR block: "blocks at most once per stop" becomes once per branch and policy content)

## Context

0013 blocks when a policy file changed and nothing under `docs/adr/` did, and skips when `stop_hook_active` is set, so it blocks at most once per stop. Stop fires after every turn and the hook keeps no memory of the answer, so once a policy file changes without an ADR, every later turn on the branch ends with the same block, even after the agent said why no ADR is needed and the human agreed (issue #92: a small `release.yml` fix, exempt under `docs/adr/README.md`, was blocked 4 turns in a row). The block asks for a judgement ("add an ADR or say why not"); repeating it adds nothing once it has been answered.

## Decision

When the hook raises the missing-ADR block as the only reason for a block, it records a key in `$(git rev-parse --absolute-git-dir)/claude-stop-adr` (per worktree, untracked, next to the check cache from 0013 and 0015). The key hashes the branch name (`(detached)` without one) and each changed policy path with its blob hash, or the dependency sections for `package.json`. The file keeps the last 50 keys, written via a temp file and `mv`. On later stops the block is skipped while the current key is in the file, and raised for a key not yet seen: a policy file edited again, another policy file changed, another branch. Reverting to an answered state, or switching branches and back, does not ask again. An ADR under `docs/adr/` still skips the block entirely. The block text says it is asked once per policy change. The green-run checks and their cache are unchanged.

When the same block also carries a red-check or missing-tool reason, the key is not recorded: the retry may fix the checks and skip the question, so it is asked again on the next stop.

We considered a `No-ADR:` commit trailer. It needs a commit, so an uncommitted policy change would still block every turn; the agent would write it itself to silence the hook, which is the same honour system as answering the block; and it would need scoping rules (which policy changes a trailer covers) to re-raise on a later change. The key needs no action from anyone: the answer to the first block, in the conversation, is the acknowledgement, which is what 0013 asks for. `.claude/hooks/stop-check.test.sh` covers raised once, a further change, a revert, a commit of the same content, another branch and back, dependency changes, a block together with red checks and an ADR on the branch.

## Consequences

An unanswered block is not repeated: if the agent ignores it, nothing asks again until the policy content changes. Review and the PR template's ADR box remain the real gate, as in 0013. A stop on a detached `HEAD` (a rebase stopped on a conflict) has its own key, so the block is asked once more there; that costs a repeated question, never a skipped one. The key file is one per worktree and concurrent sessions can drop each other's last key, with the same cost.
