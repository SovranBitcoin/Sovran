# Pass 2 surveys: implicit state machines

One survey per area. Each surveyor followed the brief below.

## Brief

You are surveying one area of the Sovran app (a Bitcoin and ecash wallet people keep money in) for **implicit state
machines**: logic whose phase is spread across independent variables, so the set of states is never written down and
illegal combinations are reachable. This is a survey. Nothing is converted in it.

Checkout: `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery` (branch `surgery/pass-2`). Read the code there, not
in any other checkout.

Rules:

- Product code is read-only. The only file you write is your own survey file, named in your task.
- No git commands that change anything. No network. Do not use `jg` (it returns an error for everyone); use grep
  and file reads.
- You may run a single test file to confirm a trace (`cd app && bun run test -- <file> --runInBand`, or
  `cd wallet && bun run test -- <file>`). Never run a whole suite: other agents share this Mac.
- Do not start subagents.
- Do not return until your survey file is written and complete.

Start from your area's pass 0 survey in `.surgery/pass-0/surveys/` (its "candidates for passes 2 and 3" list), then
read the code yourself. `.surgery/LEDGER.md` lists the tests that pin each boundary today.

Shapes to hunt:

| shape | example |
| --- | --- |
| independent flags | `isLoading`, `isError`, `data` side by side; several `useState` or refs that jointly mean a phase |
| optional-field record | `{ status, error?, result?, retryAt? }` where presence depends on `status` |
| stringly status | `status === 'pending'` compared in many files |
| effect chains | one effect sets a flag that another effect reacts to |
| broad result | returns `T \| null \| undefined \| Error`; callers cannot tell the cases apart |
| parallel collections | two arrays or maps matched by index or key that can diverge |
| derived value stored | a total kept beside its items |
| repeated validation | the same guard at every consumer |
| sentinel values | `-1`, `''`, `0` meaning "none" |

For each candidate write:

1. A name, and every file and line range that takes part.
2. The variables that jointly encode the phase.
3. States, by name. Events that move between them.
4. Combinations the representation permits that have no meaning.
5. Which of those are reachable **today**, with the concrete path (which call, in which order). Say "traced" when
   you followed the code and "run" when a test showed it. If none is reachable, say what prevents it.
6. Persisted? Name the store, key and field. A persisted shape cannot be renamed, removed or tightened in this pass;
   say whether a conversion could keep the saved shape and decode it into states at the read boundary.
7. Consumers: how many places read the flags, and which files.
8. Tests that pin it today (file names), and what a conversion would need pinned first.
9. Recommendation: **convert** (discriminated union, reducer or transition table, or a machine for async steps with
   timers, retries and cancellation; say which, and note what the repo already uses, such as `wallet/src/machine`),
   **leave** (two states and one transition, or already explicit), or **defer** (with the reason).
10. What a conversion would delete (flags, guards, effects, lines) and a rough size (S: one file, M: under ten
    files, L: more).

Also list **defects**: behaviour a maintainer would call a bug without asking what was intended (a state with no way
out, a flag left over after a later success, a reset that clears half, a swallowed error, a result ignored so failure
counts as success). Give file and line, the path that reaches it, a one-line failing test idea, and whether the repair
would touch stored data or a wire format. Do not repeat the follow-ups already in `docs/follow-ups/` (grep there
first); cite the id instead.

Do not pad. Rank the candidates: reachable illegal states times money or saved-data risk, over cost. End the file with
"Not read" (what you skipped). Aim for the ten to fifteen candidates that matter, not every `useState` pair.

Your final message: the survey file path, the top five candidates in one line each, and the defects in one line each.
