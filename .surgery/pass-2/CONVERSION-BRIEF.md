# Pass 2 conversions: builder's brief

You are making one implicit state machine explicit in the Sovran app (a Bitcoin and ecash wallet people keep money
in). The owner approved this conversion on 2026-11-11. Your task names the conversion, the survey entries that
describe it, and the checkout and branch you work in. Work only there.

## What a conversion is

1. **Pin first.** Before any product edit, make sure tests pin today's behaviour at the boundary you will change
   (the survey entry lists the pins that exist and what is missing). Add the missing ones and see them pass on the
   current code. Commit them alone ("Pin ...").
2. **Name the states.** One name per meaningful combination. Each state carries exactly the data it needs, all
   required. Encode as a discriminated union with a literal tag; where the phase moves over time pair it with a
   transition table or reducer; for async work with stale results follow the house pattern in `wallet/src/machine`
   (named steps, pure `transition`, tagged effect results, a generation counter). No XState.
3. **Carry it through every consumer.** Every reader and writer uses the new shape. Then delete the old flags,
   fields, sentinels and the guards the type now proves. A new type beside the old flags is two sources of truth and
   is not acceptable. No cast or non-null assertion added to make it compile. Consumers switch exhaustively
   (`never` check) where they branch on the state.
4. **Keep validation at the boundaries**: data read from storage (including what older releases wrote), network
   responses, late or duplicated events, interleaved async results.
5. **Subtract.** The conversion should end with fewer flags, guards and lines in product code than it started with,
   or you say exactly why not.

## Hard rules

- **Saved data.** Do not rename, remove or tighten any saved field, storage key, store version, enum value or wire
  format. Where the survey says the machine is saved, keep what is written exactly as it is and decode it into
  states where it is read. If the conversion cannot be done without changing what is written (a new field, a new
  status value, a changed meaning for an old build), STOP that part, leave the code as it is, and report it. After
  any change under `app/shared/stores` or to a persisted schema run `cd app && bun run test:upgrade` and
  `bun run test -- __tests__/persistSchemaDrift.test.ts --runInBand`; both must pass with no snapshot change.
- **Behaviour.** A conversion keeps intended behaviour. Where the survey lists a defect that the conversion is meant
  to settle (the task names them), fix it in its own commit with a test that fails first, and say before and after.
  Any other behaviour change you find necessary: stop and report instead of deciding.
- **Scope.** Only the machine in your task. No drive-by refactors, no renames outside it, no new dependencies.
  Do not touch `.surgery/`, `docs/follow-ups/` or `AGENTS.md`.
- **Git.** Stay on your branch. Small commits, one logical step each, plain imperative messages that say what the
  person using the app or the next developer gets; short body. No `Co-Authored-By` lines. Stage files by path only;
  never `git add -A` or `.`. Never `git stash`, never push, never switch branches, never rebase commits that are not
  yours.
- **Checks you run yourself and report with real numbers**: every test file you added or changed and the existing
  test files for the code you touched (`cd app && bun run test -- <file> --runInBand`; `cd wallet && bun run test`
  for the whole wallet suite if you touched `wallet/`; `cd nostr && bun run test` if you touched `nostr/`);
  `bun run type-check` at the repo root; `cd app && bun run lint` (0 errors; 263 warnings is the baseline);
  `cd app && bun run check:styling && bun run check:react-compiler` if you touched a component or hook;
  `bun run knip` at the root. Do not run the whole app suite: other agents share this Mac.
- Read `AGENTS.md` at the repo root and the survey entries before you start. Do not use `jg` (it errors). No voice
  narration. Do not start subagents. Do not return early and leave nothing running in the background.

## Final report

1. Commits, in order, each with sha and one line.
2. The states and events you named, and where the type lives.
3. What was deleted (flags, guards, effects), with net lines changed in product code (`git diff --stat` summary).
4. Behaviour changed: before and after, one line each, with the test that failed first.
5. Saved data: what is read and written before and after, and the upgrade and drift test results.
6. Check results with numbers.
7. What you stopped on, were unsure about, or left; consumers you could not move and why.
