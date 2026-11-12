# Sweep 1 surveys

One survey per area. Each surveyor followed the brief below.

## Brief

You are sweeping one area of the Sovran app (a Bitcoin and ecash wallet people keep money in) for what is
**broken, inconsistent, inefficient, no longer needed, or regrown**. This is a survey. Nothing is changed in it.

Checkout: `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery` (branch `surgery/sweep-1`). Read the code there.

Rules:

- Product code is read-only. The only file you write is your own survey file, named in your task.
- No git commands that change anything. No network. Do not use `jg` (it errors); use grep and file reads.
- You may run read-only tools (`bun run knip`, grep counts) and single test files to confirm a finding
  (`cd app && bun run test -- <file> --runInBand`; `cd wallet && bun run test -- <file>`; `cd nostr && bun run test
  -- <file>`). Never a whole suite: other agents share this Mac. Do not start subagents. No voice narration.
- Do not return until your survey file is written and complete.

Context you must read first: `AGENTS.md`; `.surgery/LEDGER.md` (four passes just ran over this code: pass 2 named
sixteen state machines, pass 3 deleted dead code and merged duplicated rules); `docs/follow-ups/README.md` (about
175 open items: grep the folder before listing anything, and cite the existing id instead of repeating it). Do NOT
re-report what the ledger or a follow-up already holds. The value of this sweep is what those passes missed, and
what their own changes left behind.

Read the area whole, file by file where you can, and say at the end what you did not read. One list per kind:

1. **Broken**: behaviour a maintainer would call a bug without asking what was intended (a flag or message left over
   after a later success; a reset that clears half; an error swallowed; a result ignored so failure counts as
   success; a crash on input the code plainly expects; a wrong total; a state with no way out; a stale async result
   applied). File and line, the exact path that reaches it, a one-line failing test idea, and whether the repair
   would touch saved data or anything sent over the network.
2. **Inconsistent**: two ways of doing one thing; a pattern followed in nine places and ignored in the tenth; names
   that no longer fit what the code does (especially after passes 2 and 3 renamed and moved things); comments and
   docs that describe code that is gone or changed.
3. **Inefficient**: repeated work, needless round trips, work redone on every render. Only with evidence of cost
   (what runs how often); an unmeasured speed-up is listed, not proposed as a fix.
4. **No longer needed**: dead code, exports only tests import, unused dependencies in `package.json`, stale feature
   flags, tests of behaviour that no longer exists, suppressions and ratchet entries that no longer apply
   (`eslint-suppressions.json` reports some), leftover mocks of deleted modules in tests, comments describing
   deleted code. Prove each with a search over every workspace, e2e scenarios and docs.
5. **Regrown**: new flag clusters or shallow wrappers that passes 2 and 3 themselves introduced (options added to
   reproduce an exit, a helper with one caller, a type beside the old flags).

For each finding give a verdict:

- **fix**: you are sure. It is an obvious defect with one clear repair that changes nothing saved or sent; or a
  removal that tools and a search agree is unreferenced and that nothing reaches by name at run time; or a
  consolidation whose two sides are identical. Say what the commit would be.
- **list**: everything else, and always anything touching saved data, migrations or wire formats, anything needing
  a product decision, deleting a test of behaviour that still exists, and code that looks dead but may be reached
  from outside the repo or guards a storage boundary. Say what the owner would have to decide.

Be concrete and brief. Twenty real findings beat sixty guesses. End the file with "Not read".

Your final message: the survey file path, how many findings per kind and how many you marked fix, and the five most
important in one line each.
