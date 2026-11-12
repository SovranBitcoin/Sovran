# Pass 3 surveys: deepening modules

One survey per area. Each surveyor followed the brief below.

## Brief

You are surveying one area of the Sovran app (a Bitcoin and ecash wallet people keep money in) for **shallow
modules and interfaces that can shrink**. This is a survey. Nothing is changed in it.

Checkout: `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery` (branch `surgery/pass-3`). Read the code there.

Rules:

- Product code is read-only. The only file you write is your own survey file, named in your task.
- No git commands that change anything. No network. Do not use `jg` (it errors); use grep and file reads.
- You may run read-only tools at the repo root (`bun run knip`, `wc -l`, grep counts) and a single test file to
  confirm something. Never a whole suite: other agents share this Mac. Do not start subagents.
- Do not return until your survey file is written and complete.

Read first: `.agents/skills/codebase-design/SKILL.md` and its `DEEPENING.md` (vocabulary: deep module, seam, the
deletion test), `AGENTS.md` (layout and import rules: `app → wallet → nostr`), your area's pass 0 survey in
`.surgery/pass-0/surveys/` (its candidates for passes 2 and 3) and pass 2 survey in `.surgery/pass-2/surveys/` (what
was deferred to pass 3). `.surgery/LEDGER.md` says what pass 2 already converted: those modules were just rewritten;
propose changes to them only where an interface is plainly wider than its callers need.

What to hunt, each with evidence from the callers:

| shape | what makes it a candidate |
| --- | --- |
| pass-through module | a file, hook or wrapper whose functions only forward to another; deleting it loses nothing |
| parameter every caller passes the same way | a flag, option or dependency with one value at every call site |
| parameter the module could work out | callers fetch something only to hand it back to the module that owns it |
| parameter nobody reads | accepted and ignored, or read only by a test |
| ordering rule on the caller | "call A before B", "remember to reset X", repeated at each call site |
| duplicated check or derivation | the same guard, normalisation or computed value at several callers |
| concept with two owners | the same rule implemented in two modules that can drift |
| single-adapter seam | a port, interface or injection point with one implementation and no test double that needs it |
| export nobody imports, or only tests | dead surface (check with knip and grep) |
| option bag grown by accretion | many optional fields, most unused by most callers |

For each candidate write:

1. A name; the module (file and lines) and every caller (files, a count).
2. The obligation callers carry today, concretely (the parameter, the ordering rule, the repeated check), with two
   or three call sites quoted by file and line.
3. The proposed shape: what the interface becomes, what moves inside, what is deleted. Say which existing module
   becomes the one owner.
4. The deletion test: what would be lost if the shallow piece were removed.
5. What it deletes, in rough lines, and whether net lines go down. A change that adds a layer must delete more than
   it adds.
6. Risk: money, keys, saved data, wire formats, navigation. Anything that would change what is stored or sent is out
   of scope for this pass: say so and stop there.
7. Tests that pin the behaviour today (file names) and what must be pinned before the cut. Tests of a shallow module
   that would be deleted with it.
8. Size (S: one or two files, M: under ten, L: more) and whether it can be done as a mechanical, behaviour-preserving
   step.

Also list **defects**: behaviour a maintainer would call a bug without asking what was intended, with file and line,
the path that reaches it, and a one-line failing test idea. Grep `docs/follow-ups/` first and cite an existing id
instead of repeating it.

Rank the candidates: obligations removed and lines deleted, over risk. Ten to fifteen that matter, not every small
helper. Prefer changes that delete. End the file with "Not read".

Your final message: the survey file path, the top five candidates in one line each (with the rough lines deleted),
and any defects in one line each.
