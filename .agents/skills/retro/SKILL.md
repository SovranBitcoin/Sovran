---
name: retro
description: Look back over one session, or over every past Claude and Codex session in this project, to find what the owner keeps having to say and what agents keep getting wrong, then fix the environment so it is not needed again. Use when asked for a retro or retrospective, "what do I keep repeating", "why do agents keep doing X", or to improve AGENTS.md, the skills or the checks from experience.
---

# Retro

The product is a short list of changes to the agent's **environment**, most valuable first,
each with the evidence for it. Propose; the owner picks what gets made.

## 1. Gather

- **This session:** reread it.
- **Past sessions:** `python3 .agents/skills/retro/user_messages.py > <scratch file>` writes
  every message the owner typed in this project, from both Claude Code and Codex, oldest
  first with dates. Read it all, in parts if it is long; `--since 2026-09-01` narrows it.
  Transcripts stay on this machine.

## 2. Look for

- The same instruction or correction in several sessions. Count sessions and keep two dated
  quotes. A correction ("no, I said…", "still broken") weighs more than an instruction given up front.
- First attempts that were rejected, and the reason given.
- Work the owner sets up by hand each time: the same list of paths, the same sequence of steps.
- A reason the owner has explained more than once. Keep their words.
- Time lost finding something, or to a tool that hung or was missing.

## 3. Choose the cheapest fix that cannot be forgotten

1. **A check** (a lint rule, a test, a script in CI, a hook) when the mistake has a fixed
   shape. Before writing one, look for an existing check that is unwired or broken.
2. **A pointer** in `AGENTS.md` when the knowledge exists but was not found.
3. **A paragraph in the doc that owns the subject** when the knowledge was never written down.
4. **A skill** only for a procedure with steps and an end, and only if no existing one fits.

Also look for what to remove: an instruction agents already follow without being told, a
rule a check now enforces, a pointer to something that no longer exists. `AGENTS.md` is read
at the start of every session, so every line in it costs something.

## 4. Report

For each proposal: what keeps happening (sessions, quotes), the fix, where it goes, and what
it replaces. Say what you counted and what you inferred.
