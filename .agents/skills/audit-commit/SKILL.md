---
name: audit-commit
description: Audit one commit, by sha, for defects, undone earlier fixes, a message that does not match the diff, missed reuse, needless code and unsafe handling of money, keys or saved data, using independent reviewers and a verification pass. Use after making a commit, when asked to audit, review or double-check a commit or a range, or when asked whether a change should have been made at all.
---

# Audit one commit

Input: a sha (for a range, run once per commit, oldest first). Output: a verdict with
evidence. Change nothing; fixes are a separate commit after the report.

The commit's title and body are **claims to test, not facts**. A reviewer who is handed the
author's explanation tends to confirm it, so reviewers get the diff and the code, never the
message.

## 1. Pin it

- `git rev-parse <sha>^{commit}`; diff against its parent with `git show <sha>` (a merge:
  against each parent). Read the whole diff, deletions and tests included.
- Read the code as it was at the sha and at its parent (`git show <sha>:<path>`), not the
  working tree.
- Write down, privately, what the message claims: each thing it says was added, fixed,
  removed or left alone.

## 2. Recover why the old code was there

For each changed region and the callers of what it changed:

- `git blame <sha>^ -- <path>` on the lines removed or rewritten, then read the commits that
  wrote them. `git log -S'<expression>' <sha>^ -- <path>` finds when a guard arrived.
- Ask of every deleted or loosened line: which earlier commit added this, what did it
  protect, and is that still protected? An earlier deliberate fix that this commit undoes is
  the most valuable finding there is.
- Stop following history once it stops explaining the change; old renames are noise.

## 3. Review independently, in parallel

Start reviewers through whatever the host offers (Claude: subagents, plus `codex exec
--sandbox read-only` for one of them when Codex is installed; Codex: its own subagents, plus
`claude -p`). A second model is one more reviewer, not a judge. Each reviewer gets the sha,
the parent, the paths and the history from step 2; none gets the message, your suspicions or
another reviewer's findings. Choose the lenses the diff calls for:

| Lens | Asks |
| --- | --- |
| Behaviour (always) | What does this change do for every caller? What breaks, races or is left half-done? |
| Adversary (always) | Hostile input, a crash or lost connection at each step, a retry, an account switch mid-way. For money and keys: can it lose, double-spend, expose or strand them? |
| Less code (always) | What here already exists elsewhere? What could be deleted instead of added? Is a new abstraction earning its place? Do the tests pin behaviour or restate the code? |
| Saved data | Touches a store, key, database or migration: can an install on any older release still read what it wrote? (`persistence-release-safety` has the invariants.) |
| Looks | Touches a screen: is it built from the parts its neighbours use? ([building screens](../../../docs/review/building-screens.md)) |

A finding is a trigger, the code path, and the result, with `sha:path:line`. Reviewers report
nothing rather than pad; what lint, types and the ratchets already catch is not a finding.

## 4. Verify every candidate yourself

Reviewers invent problems as readily as they find them. For each candidate, look for the
guard or caller that makes it wrong before accepting it, and reproduce it with the smallest
test or script when that is cheap. Drop what you cannot stand behind. Keep separate what was
reproduced, what was read in the source, and what is inferred. Problems that were already
there before this commit go in their own list.

Then compare the claims from step 1 with the diff: anything claimed and not done, and anything
done and not claimed.

## 5. Report

Lead with one verdict:

- **Sound**: nothing verified against it.
- **Fix**: verified defects, each with its smallest correction.
- **Reconsider**: the change should not have been made, or not this way. Say so plainly when
  the evidence supports it (it undoes a deliberate fix, adds what already exists, or solves
  the problem at the wrong owner) and say what should happen instead.
- **Inconclusive**: what is missing and who can supply it.

Then the findings by severity, the message-versus-diff differences, pre-existing problems, and
what was not checked (no device run, tests not executed at that sha). In plain words; the
owner reads this without the code open.

Anything real that is not fixed straight away becomes an entry in
[`docs/follow-ups`](../../../docs/follow-ups/README.md).
