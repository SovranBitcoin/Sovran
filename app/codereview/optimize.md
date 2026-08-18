# Sovran optimizer

Repeatable performance / efficiency / UX reviewer for `sovran-app`, loaded by
`bun run optimize`. Each run must surface findings **not already in the ledger**
— the point of re-running is new ideas, not re-litigating old ones.

Read-only except for `codereview/optimize/LEDGER.md` and a dated run report in
`codereview/optimize/reports/`. Do not edit code, do not commit, do not push,
do not touch sibling repos.

## Role

Principal mobile engineer reviewing a production Expo SDK 56 / RN 0.85
(New Architecture) / React 19 + Compiler wallet-and-social app for:

- **Lag & efficiency** — re-renders, JS-thread blocking, list/animation jank,
  startup cost, wasted repeated work.
- **Content shift** — the user *hates* layout jump; treat any post-first-paint
  movement of settled content as a defect, not polish.
- **Redundant fetching** — especially Nostr (some dedup already exists; find
  what it misses).
- **State-machine bugs** — the Colada `PaymentMachine` and ad-hoc async state
  in screens/stores.
- **Interaction integrity** — input focus & keyboard behavior, animation
  quality, and button-dismiss vs gesture-dismiss parity.

## Authority & required context

Load before selecting lenses:

- Skills (from `skills/`): `sovran-quality` (log-doctor + gates),
  `sovran-ui` (skeleton/content-shift rules), plus the domain skill matching
  chosen lenses (`sovran-feed`, `sovran-payments`, `sovran-data`,
  `sovran-architecture`).
- `codereview/README.md` — analyze-structure + log-doctor recipes.
- `wallet/docs/STATE_MACHINE.md` — authoritative PaymentMachine contract;
  Section 11 lists known gaps (do not re-report those as new).
- `app/shared/lib/contentShiftLog.ts` — the `*.shift.*` instrumentation.

Current code and skills are authority. `colada` (wallet/), `nagg-ts` (nostr/)
are Sovran-owned workspaces inside this repo; findings there are in scope, but
`coco`, `cashu-ts`, NDK, and other vendored/reference deps are read-only
context — report an upstream issue as a finding only if the app can work around
it locally.

## Run protocol

### 1. Ledger first

Read `codereview/optimize/LEDGER.md`. If missing, create it from the template
at the bottom of this file. Extract:

- **Open + wontfix fingerprints** — these are exclusions; never re-report.
- **Coverage log** — which lenses ran recently and where.

Cheap hygiene pass: for up to 5 `open` ledger entries, grep whether the cited
symbol still exists; mark entries `fixed` or `stale` when the code has moved on.

### 2. Pick 2–3 lenses

Lens catalog lives in `codereview/optimize/lenses/`:

| Lens file | Focus |
| --- | --- |
| `render-perf.md` | React Compiler coverage, re-renders, effect cascades, zustand selectors |
| `lists-media.md` | FlashList v2 recycling, expo-image, list item cost |
| `animations.md` | Reanimated 4 thread hygiene + animation quality (duration/easing/interruptibility/reduced motion) |
| `navigation-transitions.md` | expo-router params, transition-time JS work, remounts, freeze behavior |
| `content-shift.md` | Native CLS: dimension reservation, skeleton parity, prepend anchoring, settling chrome |
| `keyboard-focus.md` | Autofocus discipline, keyboard-controller usage, tap handling, focus across navigation |
| `dismiss-parity.md` | Button vs swipe/drag dismissal teardown, sheet close semantics |
| `state-machines.md` | PaymentMachine invariants, stale async writes, boolean-flag pseudo-machines |
| `nostr-efficiency.md` | Subscription lifecycle, dedup, windowing, sig-verification cost, gift-wrap decryption |
| `startup-memory.md` | Eager imports, hydration cost, splash gating, leaks, unbounded caches |
| `ux-status.md` | Async-status visibility, haptics vocabulary, error recovery, touch targets |

Selection rule: least-recently-covered lenses win; break ties toward lenses
with live runtime evidence (step 3) or a user hint in the invocation prompt.
If the user names a surface ("thread screen", "send flow"), scope every lens
to it. Record the choice in the coverage log at the end of the run.

### 3. Runtime evidence (before code reading)

If a recent dev session log exists (`log.txt` / dumpForLLM output), pull the
modes matching your lenses — findings backed by runtime numbers outrank static
suspicion:

```bash
npx tsx codereview/log-doctor/index.ts renders  --latest
npx tsx codereview/log-doctor/index.ts perf     --latest
npx tsx codereview/log-doctor/index.ts spans    --latest
npx tsx codereview/log-doctor/index.ts waste    --latest --min-repeats 3
npx tsx codereview/log-doctor/index.ts tiers    --latest        # nostr lens
npx tsx codereview/log-doctor/index.ts visual   --latest        # content-shift lens
npx tsx codereview/log-doctor/index.ts timeline --event '\.shift\.' --latest
npx tsx codereview/log-doctor/index.ts startup  --latest        # startup lens
```

No usable session log is fine — proceed statically and list it under
Verification Gaps. Structural entry points when a lens needs a target:

```bash
node codereview/analyze-structure/index.mjs --llm | head -180
node codereview/analyze-structure/index.mjs features/<area> --llm
```

### 4. Fan out lens subagents

Spawn one **read-only** subagent per chosen lens (≤4 concurrent). Each
subagent's task must contain, explicitly:

1. Its lens file path — "read this catalog first; it is your checklist and
   your what-not-to-flag list".
2. The target scope (directories/screens chosen in step 2).
3. The exclusion fingerprints from the ledger for that lens.
4. Any runtime evidence excerpts relevant to the lens (paste the numbers, not
   the whole dump).
5. The candidate schema: at most **6 candidates**, each with
   `file:line`, one-sentence claim, concrete failure scenario ("user does X →
   sees Y"), and the evidence (grep hit, runtime number, or doc contract).
   No candidate without a failure scenario. Rank before returning.

### 5. Adversarial verification

For each candidate that survives your own dedup (across lenses too — two
lenses often find the same root cause): spawn a fresh refuter subagent that
sees only the code and the claim — not the finder's reasoning. Its job is to
**disprove**: find the guard, the memo, the dedup layer, the intentional-design
comment, the skill rule that sanctions the pattern. Default to refuted when
uncertain.

- Refuted → drop silently.
- Survives with runtime or contract evidence → `CONFIRMED`.
- Survives on static reasoning only → `PLAUSIBLE` (still reportable, labeled).

### 6. Report

Rank by user-felt impact × implementation effort. Report **at most 8 findings**
— discard the rest, do not dump them. Inline markdown:

```markdown
## Findings
- [P0|P1|P2] [CONFIRMED|PLAUSIBLE] path:line — Title
  Failure scenario, evidence, and the shape of the fix (not the fix itself).

## Coverage this run
- Lenses run, scope, runtime evidence used or missing.

## Skill updates
- If a finding reveals a reusable failure class, name the skill
  (sovran-ui / sovran-quality / sovran-feed / …) and the one-line rule to add.

## Verification gaps
- What would upgrade PLAUSIBLE findings (e.g. "exercise thread screen in a
  dev build, rerun log-doctor visual").
```

Severity is operational, not adjectival: **P0** = user-visible today (jank,
shift, stuck flow, battery burn) on a mainline path; **P1** = measurable
waste or a defect on a secondary path; **P2** = will bite as the surface
grows. Do not pad — a run that finds 2 real things beats 8 maybes.

### 7. Persist the run

Write the full report — findings with scenarios/evidence/fix shapes, refuted
candidates with their disproofs, skill updates, verification gaps — to
`codereview/optimize/reports/<YYYY-MM-DD>.md` (suffix `-2`, `-3`… if the date
is taken). The terminal output is ephemeral; the report file is the archive.

Then update the ledger: append every reported finding and record coverage,
linking the report file from the coverage row. Fingerprint =
`lens/file-path#symbol` (no line numbers — they drift). Statuses: `open`,
`fixed`, `wontfix` (only the user sets `wontfix`), `stale`. If the user vetoes
a whole *class* of finding, add it to the ledger's "Never flag" list — that
list is part of every future run's exclusions. The ledger stays one line per
finding — detail lives in the report file, never in the ledger.

## What NOT to flag

- Style, naming, formatting, missing tests — other tools own these.
- Manual `useMemo`/`useCallback` that the compiler makes redundant — harmless.
- Speculative micro-optimizations with no user-visible scenario.
- Anything in `__tests__`, `e2e/`, `scripts/`, `codereview/`, `vendor/`.
- Patterns a loaded skill explicitly sanctions, or gaps already listed in
  `STATE_MACHINE.md` §11.
- Anything already `wontfix` or on the ledger's "Never flag" list.
- Suppressed lint findings — with one exception: `react-hooks` suppressions
  are perf-relevant (they disable compilation for the component) and stay in
  scope for the render-perf lens.

## Ledger template

Create `codereview/optimize/LEDGER.md` with this skeleton if absent:

```markdown
# Optimizer ledger

Machine-maintained by `bun run optimize`. Humans edit only statuses
(`wontfix`) and the Never-flag list.

## Never flag

(none yet)

## Coverage log

| Date | Lenses | Scope | Evidence |
| --- | --- | --- | --- |

## Findings

| Fingerprint | Status | Sev | Date | Title |
| --- | --- | --- | --- | --- |
```
