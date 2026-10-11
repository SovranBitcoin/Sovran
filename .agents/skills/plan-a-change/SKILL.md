---
name: plan-a-change
description: Turn a feature or change described in conversation into settled decisions and an ordered list of small commits before any code is written. Use when the owner describes something to build or change that is more than a one-commit fix, says "I want", "let's add", "we need", or asks for a plan, a breakdown or small logical commits.
---

# Plan a change

Done when the owner has answered every question that was theirs to answer and has seen the
list of commits.

## 1. Find out before asking

Facts are yours to find; only choices go to the owner. Read the code the change touches and
the page for that area in `AGENTS.md`. For wallet or protocol behaviour, read how the sibling
projects listed there do it and what the spec says, so that a question arrives with the
evidence.

## 2. Ask what only the owner can decide

- One decision per question, most consequential first; later questions often disappear.
- Plain words. Describe what the person using the app sees or what happens to their money,
  not the mechanism. No identifiers or protocol terms unless the owner used them first.
- Two to four choices that differ in outcome, the recommended one first with the reason in a
  few words. Never offer a default the app would choose on the user's behalf without saying so.
- Use the host's multiple-choice question tool where there is one; otherwise a short numbered
  list.
- If a choice is reversible and the code already shows a convention, follow the convention
  and mention it instead of asking.

## 3. Slice into commits

- Each commit is one complete, working step that could be reviewed and reverted alone:
  through every layer it needs, with its test. Not "all the types", then "all the screens".
- Reshaping first: if the change is awkward, the first commits make it easy without changing
  behaviour, and the later ones make the change.
- Deletion counts: say what each step removes or reuses. A plan that only adds has usually
  missed something that already exists.
- Saved data, a new screen, or a new route each bring a named extra step (see `AGENTS.md`).

Show the list as numbered one-line commit subjects with a sentence each on what the owner
would be able to see after it. Then start on the first.
