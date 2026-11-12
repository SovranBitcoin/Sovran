# Pass 3 cuts: builder's brief

You are deepening modules in the Sovran app (a Bitcoin and ecash wallet people keep money in). The owner approved
groups A and B of `.surgery/LEDGER.md`, section "Pass 3", on 2026-11-12. Your task names the cuts, the survey
entries that describe them, and the checkout and branch you work in. Work only there.

## What a cut is

- **Group A (dead code):** delete code nothing in the app reaches. Before deleting each piece, prove it: search every
  workspace (`app`, `wallet`, `nostr`, `docs`, `site`, `harness`, e2e scenarios, native modules) for importers and
  for string references (dynamic imports, route names, store keys, test IDs). "Only its own test imports it" counts
  as dead; delete that test with it. If something turns out to have a live caller, leave it and say so.
- **Group B (one owner):** give a duplicated rule, parameter or ordering obligation one owner. Pin first: make sure
  a test covers today's behaviour at the boundary you change (add it and see it pass on the current code, committed
  alone), then move EVERY caller to the new shape and delete the old path completely. No old path left "for
  compatibility", no wrapper that forwards to the new one.
- Both: **behaviour must not change.** A cut that would change what a person sees, what is saved, or what is sent is
  not a cut: stop on it and report. If you find a defect while cutting, do not fix it inside the cut: report it (fix
  it in its own commit with a failing test first only if the repair is one obvious line and nothing saved or sent
  changes).

## Rules

- **Subtract.** Each cut must remove something a caller had to know (a parameter, an ordering rule, a duplicated
  check) or code nothing reached, and product lines must go down. Report `git diff --shortstat` for product files
  (not tests) per cut. If a cut would add lines, do not make it; say why.
- **No new seam with one implementation.** No new port, interface or injection point unless two real
  implementations need it.
- **Saved data and wire formats are off limits:** no saved field, storage key, store version, enum value, database,
  route param encoding or network payload may change. A saved field that code no longer reads stays in the schema
  and keeps being written exactly as before if an older build reads it. After any change under `app/shared/stores`
  or to a persisted schema run `cd app && bun run test:upgrade` and
  `bun run test -- __tests__/persistSchemaDrift.test.ts --runInBand`; both must pass with no snapshot change.
- **Tests move with the interface.** Tests of behaviour stay, re-pointed at the new shape. Delete a test only when
  the thing it tested is gone and nothing observable is left uncovered.
- **Generated and ratchet files:** `storeRegistryManifest.ts` is generated (regenerate with the project's script,
  never edit); budget and suppression files may only go down. Native modules, patches and vendored code are not
  touched.
- **Scope:** only the cuts in your task. Do not touch `.surgery/`, `docs/follow-ups/` or `AGENTS.md`. If a document
  under `docs/` or a README describes something you delete, correct that sentence in the same commit.
- **Git:** stay on your branch. One commit per cut (pins separately), plain imperative messages saying what a
  developer no longer has to know or what was removed; short body. No `Co-Authored-By` lines. Stage files by path
  only; never `git add -A` or `.`. Never stash, push, switch branches or rewrite commits that are not yours.
- **Checks you run yourself, at the end and after any risky cut, reported with real numbers:** the test files for
  the code you touched (`cd app && bun run test -- <file> --runInBand`); `cd wallet && bun run test` if you touched
  `wallet/`; `cd nostr && bun run test` if you touched `nostr/`; `bun run type-check` at the root; `cd app && bun
run lint` (0 errors; 243 warnings is the baseline); `cd app && bun run check:styling && bun run
check:react-compiler`; `bun run knip`. Do not run the whole app suite: other agents share this Mac.
- Read `AGENTS.md` and the survey entries before you start. Do not use `jg` (it errors). No voice narration. Do not
  start subagents. Do not return early; leave nothing running.

## Final report

1. Per cut: commit sha(s), what callers no longer have to know or what was removed, product lines added and
   removed, tests moved or deleted.
2. Anything you found had a live caller and left.
3. Behaviour: confirm none changed, or list exactly what did and why you stopped or went on.
4. Check results with numbers.
5. Defects seen and left; cuts you did not make and why.
