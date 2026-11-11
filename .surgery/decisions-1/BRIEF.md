# Decisions 1: builder's brief

You are building changes the owner decided on 2026-11-12 for the Sovran app (a Bitcoin and ecash wallet people keep
money in). The decisions are the table "Decisions (owner, 2026-11-12, after sweep 1)" at the end of
`.surgery/LEDGER.md`. Your task names which rows are yours, the survey entries that describe each problem, and the
checkout and branch. Work only there.

How to work:

- Read `AGENTS.md` first, then the survey or follow-up entry for each item, then the code.
- **Pin first.** Before changing behaviour, make sure a test covers today's behaviour at that boundary (add it, see
  it pass, commit it alone), so the change shows up as a deliberate edit to a test.
- **A behaviour change:** one commit per decision, with tests that fail before and pass after (say how you saw them
  fail). Do exactly what the decision says, no more. Where the decision leaves a detail open, take the smallest
  choice consistent with it and say what you chose.
- **A deletion:** prove nothing reaches it: search every workspace (`app`, `wallet`, `nostr`, `docs`, `site`,
  `harness`), e2e scenarios and probes, native modules, string and dynamic references, `jest.mock` factories.
  Delete tests only of the deleted code. If something has a live caller, leave it and say so.
- **Wording people read:** reuse an existing string where one fits. New wording goes in the copy catalogue the
  screen already uses and must pass `bun run copy:lint` where that script exists; keep it short and plain; list
  every new string in your report so the owner can change it.
- **New on-screen controls** get a stable `testID` and an accessible label, as `AGENTS.md` "Native testability"
  asks; say which you added.

Hard limits:

- No saved field, storage key, store version or enum value is renamed, removed or tightened. A new saved field is
  allowed only if a decision cannot be met without it: then it is optional with a default, with no version bump,
  and you run `cd app && bun run test:upgrade` and `bun run test -- __tests__/persistSchemaDrift.test.ts
  --runInBand`, updating a drift snapshot only for that one added field (regenerate with `-u` WITHOUT `-t`), and you
  say so prominently. Prefer in-memory state.
- Anything published to relays or sent to a mint changes only as the decision says.
- No new dependency. No native module, patch or vendored code changes. `storeRegistryManifest.ts` is generated.
- Do not touch `.surgery/`, `docs/follow-ups/` or `AGENTS.md`.
- Git: stay on your branch; small commits, plain imperative messages saying what a person gets, short before/after
  body; no `Co-Authored-By` lines; stage by path only (never `git add -A` or `.`); never stash, push, switch
  branches or rewrite commits that are not yours.

Checks you run yourself and report with real numbers: every test file you touched and the existing ones for that
code (`cd app && bun run test -- <file> --runInBand`); `cd wallet && bun run test` if you touched `wallet/`;
`cd nostr && bun run test` if you touched `nostr/`; `bun run type-check` at the root; `cd app && bun run lint` (0
errors; 241 warnings is the baseline); `cd app && bun run check:styling && bun run check:react-compiler`;
`bun run knip`; `cd app && bun run e2e:validate` if you added a control. Not the whole app suite: other agents share
this Mac. Do not use `jg`. No voice narration. No subagents. Do not return early; leave nothing running.

Final report: per decision, the commits, what a person now sees (before and after), the tests that failed first,
every new string and control, anything saved or sent that changed, what you chose where the decision was open, and
what you left and why. Then the check numbers.
