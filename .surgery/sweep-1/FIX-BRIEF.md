# Sweep 1 fixes: builder's brief

You are fixing what a sweep of the Sovran app (a Bitcoin and ecash wallet people keep money in) found and marked
**fix**. Your task names the survey files, the checkout and the branch. Work only there.

Take ONLY findings whose verdict is **fix**. Findings marked **list** are for the owner: do not touch them. For
each fix-marked finding, first check it yourself against the code; the surveyor traced most of them and ran few.

- **A defect:** write a test that fails because of it (say how you saw it fail), then repair it, in one commit. If
  you cannot make a test fail, the defect is not confirmed: leave the code and report it.
- **A removal:** prove nothing reaches it: search every workspace (`app`, `wallet`, `nostr`, `docs`, `site`,
  `harness`), e2e scenarios, native modules, string and dynamic references, `jest.mock` factories. "Only its own
  test uses it" counts as dead; its test goes with it. One commit per removal or small group of the same kind.
- **A consolidation or rename:** only when the two sides are identical or the name is plainly wrong; existing tests
  must pass unchanged except for names and imports.
- **A comment or doc that describes code that is gone:** correct it; several in one area may share a commit.

Downgrade to "left" and report, without changing code, whenever on closer reading: the repair would change a saved
shape, storage key, store version, route param encoding or anything sent over the network; there are two reasonable
repairs; a caller depends on today's behaviour; the fix is bigger than the finding (a redesign); or you are not sure.
Being sure is the bar. It is fine to leave half the list.

Rules: change only what each finding needs; no drive-by edits. Do not touch `.surgery/`, `docs/follow-ups/` or
`AGENTS.md`; native modules, patches and vendored code are not touched; `storeRegistryManifest.ts` is generated;
ratchet and suppression files may only go down. Stay on your branch; small commits with plain imperative messages
saying what a person or developer gets, short before/after body; no `Co-Authored-By` lines; stage by path only,
never `git add -A` or `.`; never stash, push, switch branches or rewrite commits that are not yours. After any
change under `app/shared/stores` or to a persisted schema run `cd app && bun run test:upgrade` and
`bun run test -- __tests__/persistSchemaDrift.test.ts --runInBand` (no snapshot change).

Checks you run yourself and report with real numbers: every test file you touched and the existing ones for that
code (`cd app && bun run test -- <file> --runInBand`); `cd wallet && bun run test` if you touched `wallet/`;
`cd nostr && bun run test` if you touched `nostr/`; `bun run type-check` at the root; `cd app && bun run lint` (0
errors; 242 warnings is the baseline); `cd app && bun run check:styling && bun run check:react-compiler`;
`bun run knip`. Not the whole app suite: other agents share this Mac. Read `AGENTS.md` first. Do not use `jg`. No
voice narration. No subagents. Do not return early; leave nothing running.

Final report, as a table: finding id, verdict you reached (fixed / removed / left), commit sha, for a defect the
failing-first test and before/after in one line, for a "left" the reason. Then product lines added and removed in
total, the check numbers, and anything new you noticed.
