# Hunch conformance sweep — protocol

The procedure behind the `/goal` condition for the autonomous rule-conformance
sweep. The goal states *when to stop*; this states *how to work*. The running
record is `docs/review/sweep-ledger.md`.

Never ask a question: resolve it from the repository, its history, or the sibling
wallets in `~/Documents/GitHub`, or record it as `blocked` with the specific
missing fact and move on. One domain per pass, one finding per commit.

## The ledger is the memory

`docs/review/sweep-ledger.md` is the single durable record. Read it first, write
to it after every finding, and trust it over your own recollection — you will be
compacted or restarted mid-sweep and it is the only thing that survives.

It holds, in order: the domain queue with per-domain status
(`pending` / `in-progress` / `done`), and one row per finding:

```
- [domain/rule-id] path/to/file.ts:LINE — <one-line claim>
  verdict: defect | false-positive | intentional | blocked
  evidence: <blame sha + subject, sibling prior art, or the contract that settles it>
  action: <commit sha, rule edit, or why nothing changed>
```

Never delete a row. A finding you already ruled `intentional` or
`false-positive` is closed — if it reappears on a later run, that is a signal the
rule needs narrowing, not that the verdict was wrong.

## Domain queue

Batch by rule-id prefix, smallest and highest-stakes first, so a bad pass costs
one domain and not the repo:

```
entropy → secrets → payments → money → state → nostr → errors → ui
→ nip17,nip59,nip61,nip60,nip46,nip65,nip04,nip19,nip01,nip06
→ nut06,nut10,nut11,nut12,nut18 → bip32,bip39,bip43,bip21,bip321
→ agents-md → skill/* (by skill) → doc/* (by convention file)
```

Finish a domain completely — every finding triaged, every fix committed,
verification green — before starting the next. One domain per pass.

## Per-domain procedure

1. **Scope the cost first.**
   `hunch check --all --only "<domain>/*" --dry-run` to see the size, then run it
   for real with `--reporter json` into the scratchpad. Use `--all` (whole files,
   not just the branch diff) — this is a conformance sweep of existing code, not
   a PR review. If a domain is too large in one shot, split it by path
   (`hunch check --all --only "state/*" app/features/...`) and keep the sub-slices
   in the ledger.

2. **Verify every flag in source before touching anything.** Hunch findings are
   candidates. Open the file, read the surrounding contract, and confirm the
   mechanism the rule asks about is actually present. A flag you cannot confirm
   in source is a false positive or a rule-precision problem, not a defect.

3. **Blame before you change behaviour.** For every confirmed flag, run
   `git log -L<start>,<end>:<file>` or `git blame -w -C -C -L` on the exact lines
   and read the commit that introduced them — subject, body, and the diff around
   it. Then answer, in the ledger, in one sentence: *was this shape deliberate?*
   - Commit message names the behaviour, or the code carries a comment, an ADR in
     `app/docs/adr`, a test asserting it, or an entry in `docs/review/contracts.md`
     → it is intentional. Do not "fix" it. Either mark the finding `intentional`
     with that evidence, or narrow the rule so it stops asking about this shape.
   - Introduced incidentally, in a commit about something else, with no test or
     doc pinning it → it is a candidate defect. Proceed.

4. **Look outward before you invent a fix.** For anything Cashu- or Nostr-shaped,
   read how the field already solves it before designing something new. On disk:
   `~/Documents/GitHub/{macadamia, minibits_wallet, cashu.me, cdk, wallet,
   nutshell, cashu-ts, coco, nuts}`. Use `hunch find "<the behaviour>" --mode
   condition --cwd ~/Documents/GitHub/<repo>` to locate it semantically, or grep
   when you know the symbol. `nuts` is the spec; `coco` and `cashu-ts` are what we
   actually import, so a question about wire format or crypto is usually answered
   by reading our dependency, not by writing code here. Treat the other wallets as
   **evidence, not authority** — we are trying to be better than them. Quote what
   they do in the ledger row, then say whether we match, improve on it, or
   deliberately differ. If every sibling does X and we do Y with no recorded
   reason, that is a strong defect signal.

5. **Find the blast radius before you edit.** `hunch find "<the change you intend
   to make>"` inside this repo to surface the callers, contracts, tests and
   precedent the change touches. Fix the mechanism at its owner (per the layering
   in `AGENTS.md`: `app → wallet → nostr`, never upward), not at each call site.

6. **Apply the smallest correct fix.** Change the behaviour, add or extend the
   test that pins it, and nothing else. No drive-by refactors, no renames, no
   reformatting in a fix commit.

7. **Verify, then commit.** Before every commit, run the gates that the change
   actually touches:
   `bun run type-check`, the specific test file (`cd app && bun run test -- <file>
   --runInBand`, or `bun run test -- <file>` in `wallet`/`nostr`), `cd app && bun
   run lint`, plus `bun run knip` when you removed code and
   `bun run check:styling` / `check:react-compiler` when you touched UI. Then
   `hunch check --only "<domain>/*"` on the diff to confirm the finding is gone
   and you did not create a new one. Commit only when they pass. If a gate was
   already red on `main`, say so in the ledger and do not attribute it to your
   change.

## Commits

One finding, one commit — never a pile of uncommitted work. Conventional-commit
subject, scope = the domain. The body states: the rule that flagged it, the blame
finding (sha + whether it was deliberate), the sibling prior art if it informed
the fix, and the verification that ran with its result. Work on the current
branch; never commit to `main`, never push. End each message with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Rule edits commit **separately** from code fixes (`chore(hunch): …`), so a rule
change can be reverted without losing a real fix.

## The rules are in scope too — this is the feedback loop

Every finding you triage teaches you something about the rule. Act on it, because
the rule is what the *next* pass will run.

- **False positive** → the rule is imprecise. Fix it in `hunch.config.ts`: sharpen
  the `instructions` to name the exact mechanism and the shapes that are *not* it,
  tighten `when`, scope `files`, or extend the `unrelated` criterion. Then
  `hunch config --explain <rule>` to read back what Jev now receives, `hunch config`
  to validate, `hunch install` if packs or compiled sources changed, and re-run
  that rule on the same file to confirm the flag is gone.
- **Rule asks two questions at once** → split it into two ids with distinct
  `message`s. Findings that mix "is it X?" with "is it Y?" are unfixable as one.
- **Rule reviews code we don't own** → delete it. The selection principle already
  written into `hunch.config.ts` stands: keep a rule only where *this* repository
  makes the decision the rule is about. Crypto and wire format belong to `coco`,
  `cashu-ts`, `nostr-tools` and NDK.
- **Rule keeps abstaining `insufficient-context`** → it is asking about something
  the diff window cannot show. Either raise `contextLines`, or rewrite it as a
  whole-file question.
- **Real class of defect with no rule** → add one, with `reference:` pointing at
  the doc that justifies it.

After any rule edit, record in the ledger the before/after finding count for that
rule on the same scope. Precision going up is the point; findings going to zero
because you blunted the question is the failure mode.

## Do not cheat the loop

You are being graded on real defects fixed, not on findings cleared. All of the
following are failures, not progress, and must never be used to close a finding:

- weakening or deleting a rule to silence a flag you believe is real;
- narrowing `when` so a true positive stops matching;
- deleting, skipping, or loosening a test's assertions so a gate goes green;
- adding a suppression, `eslint-disable`, `@ts-expect-error`, `as any`, or a
  budget/baseline bump to pass a check;
- catching and swallowing an error so a failure stops surfacing;
- reporting a fix you did not verify, or claiming a gate passed that you did not
  run.

If a finding is real and you cannot fix it safely, mark it `blocked` with the
reason and move on. A `blocked` row is an honest outcome; a silenced rule is not.
Ratchets and suppression files (`knip`, styling, react-compiler budgets) only move
down during this sweep, never up.

## Stop conditions

Stop the pass and write a summary — do not keep grinding — when any of these hit:

- the domain queue is empty;
- the same command fails three times in a row, or you have edited the same file
  back and forth twice with no net progress (you are in the gutter);
- a fix would require a persisted-schema change — renaming, removing or tightening
  any persisted field or `z.enum`/union value. That wipes durable user data through
  the persist `merge`. Mark it `blocked`, note the required `.catch()` tolerance or
  `version` + `migrate` path, and leave it for me;
- a fix would need a new dependency, a native/config/patch change, a push, or any
  funded or destructive E2E run;
- verification is red for a reason you did not cause and cannot attribute.

## Report at the end of each domain

One short written summary: findings triaged, split by verdict; commits landed with
shas and subjects; rules edited and why; anything `blocked` and the specific fact
that would unblock it; and the next domain in the queue. The ledger is the durable
copy — the summary just points at it.

Start with `entropy`.
