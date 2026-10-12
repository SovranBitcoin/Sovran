---
name: audit-commit
description: Audit one commit, by sha, for defects, undone earlier fixes, a message that does not match the diff, missed reuse, needless code and unsafe handling of money, keys or saved data, using independent reviewers and a verification pass. Use after making a commit, when asked to audit, review or double-check a commit or a range, or when asked whether a change should have been made at all.
---

# Audit one commit

Input: a sha (for a range, run once per commit, oldest first). Output: a verdict with
evidence. The audit changes no code; fixes are a separate commit after the report.

The commit's title and body are **claims to test, not facts**. A reviewer who is handed the
author's explanation tends to confirm it, so reviewers get the diff and the code, never the
message.

## 1. Pin it

- Read the whole diff against the parent, deletions and tests included: `git show --format=
  <sha>` (a merge: against each parent). Sample generated or bulk files and list them under
  "not checked".
- Read code as it was at the sha and at its parent (`git show <sha>:<path>`), not the working
  tree. To run anything at the sha, use `git worktree add --detach <scratch dir> <sha>` and
  remove it afterwards.
- Write down, privately, what the message claims: each thing it says was added, fixed, removed
  or left alone.

## 2. Recover why the old code was there

Skip this step when the commit removes or loosens nothing. Otherwise, for each changed region
and the callers of what it changed:

- `git blame <sha>^ -- <path>` on the lines removed or rewritten, then read the commits that
  wrote them. `git log -S'<expression>' <sha>^ -- <path>` finds when a guard arrived.
- Ask of every deleted or loosened line: which earlier commit added this, what did it protect,
  and is that still protected? An earlier deliberate fix that this commit undoes is the most
  valuable finding there is.
- Stop following history once it stops explaining the change; old renames are noise.

## 3. Review independently, in parallel

One reviewer per lens, through whatever the host offers (Claude: subagents; Codex: its own).
A commit that touches money, keys or saved data also gets one reviewer from the other tool
(`codex exec --sandbox read-only`, or `claude -p`) as one more opinion, not a judge. For a
small commit, or one that is only documentation or tooling, two reviewers share the lenses.

Each reviewer gets the sha, the parent, the paths, the history from step 2, and the instruction
to read the diff with `git show --format= <sha>` so that it never sees the message. None gets
your suspicions or another reviewer's findings. A reviewer that has not answered in ten minutes
is dropped and named under "not checked".

| Lens | Asks |
| --- | --- |
| Behaviour (always) | What does this change do for every caller? What breaks, races or is left half-done? |
| Adversary (always) | Product code: hostile input, a crash or lost connection at each step, a retry, an account switch mid-way; for money and keys, can it lose, double-spend, expose or strand them? A script or check: what does it wrongly pass and wrongly fail on input its author did not picture? |
| Less code (always) | What here already exists elsewhere? What could be deleted instead of added? Is a new abstraction earning its place? Do the tests pin behaviour or restate the code? |
| Saved data | Touches a store, key, database or migration: can an install on any older release still read what it wrote? (`persistence-release-safety` has the invariants.) |
| Looks | Touches a screen: is it built from the parts its neighbours use? ([building screens](../../../docs/review/building-screens.md)) |

The saved checks hold this repository's standing questions. List the ones for what the commit
touches with `jevlint check '<family>-*' --dry-run` (families are in the `AGENTS.md` table) and
hand each reviewer the matching question text: it says what is a concern and what is allowed.
For a commit on money, keys or saved data, also run those checks and give the reviewer the
returned source as the surrounding code to read. A check searches the working tree, not the
sha, and returns evidence, never a finding.

A finding is a trigger, the code path and the result, with `sha:path:line`, labelled
**reproduced**, **read in the source** or **inferred**. What lint, types and the ratchets
already catch is not a finding.

## 4. Verify every candidate yourself

Reviewers invent problems as readily as they find them. For each candidate, look for the guard
or caller that makes it wrong before accepting it, and reproduce it with the smallest test or
script when that is cheap. Check whether a later commit already fixed it. Problems that were
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

Then the findings, most serious first; the message-versus-diff differences; pre-existing
problems; and what was not checked (no device run, tests not executed at that sha). Write for
an owner who does not have the code open.

Once the report is delivered, whoever ran the audit either fixes each verified finding in a
new commit or opens an entry for it in [`docs/follow-ups`](../../../docs/follow-ups/README.md).
