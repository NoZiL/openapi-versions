# 0024. The Stop hook raises the missing-ADR block once per policy change

- Status: accepted
- Date: 2026-11-09
- Amends: [0013](0013-stop-hook-adr-and-check.md) (the missing-ADR block: "blocks at most once per stop" becomes once per branch and policy content)

## Context

0013 blocks when a policy file changed and nothing under `docs/adr/` did, and skips when `stop_hook_active` is set, so it blocks at most once per stop. Stop fires after every turn and the hook keeps no memory of the answer, so once a policy file changes without an ADR, every later turn on the branch ends with the same block, even after the agent said why no ADR is needed and the human agreed (issue #92: a small `release.yml` fix, exempt under `docs/adr/README.md`, was blocked 4 turns in a row). The block asks for a judgement ("add an ADR or say why not"); repeating it adds nothing once it has been answered.

## Decision

When the hook raises the missing-ADR block it records a key in `$(git rev-parse --absolute-git-dir)/claude-stop-adr` (per worktree, untracked, next to the check cache from 0013 and 0015). The key hashes the branch name and each changed policy path with its blob hash (`deleted` if gone), or the dependency sections for `package.json`. On later stops the block is skipped while the key is unchanged and raised again when it changes: a policy file edited again, another policy file changed, or another branch. An ADR under `docs/adr/` still skips the block entirely. The block text says it is asked once. The green-run checks and their cache are unchanged.

We considered a `No-ADR:` commit trailer. It needs a commit, so an uncommitted policy change would still block every turn; the agent would write it itself to silence the hook, which is the same honour system as answering the block; and it would need scoping rules (which policy changes a trailer covers) to re-raise on a later change. The key needs no action from anyone: the answer to the first block, in the conversation, is the acknowledgement, which is what 0013 asks for. `.claude/hooks/stop-check.test.sh` covers raised once, a further change, a commit of the same content, another branch and an ADR on the branch.

## Consequences

An unanswered block is not repeated: if the agent ignores it, nothing asks again until the policy content changes. Review and the PR template's ADR box remain the real gate, as in 0013. The key is one file per worktree, so switching branches and back raises the block again for the first branch; that costs a repeated question, never a skipped one. Content that returns to a state already acknowledged on the same branch (an edit reverted) is not raised again.
