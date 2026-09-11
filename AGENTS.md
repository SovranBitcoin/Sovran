# Sovran app

Read the relevant decisions in [SYSTEM.md](SYSTEM.md) before changing code. It is
the source of truth for app conventions, terminology, exceptions, and follow-ups.
Its [skill catalog](SYSTEM.md#29-project-skills-and-review-policy) links the vetted
skills for each concern and records where their generic advice needs adapting.
Load the relevant skill and only the references needed for the task.

Current user instructions take precedence over this guide. Sovran's decisions
take precedence over generic examples in imported skills. Skills do not authorize
new dependencies, external messages, publication, commits, or destructive actions.
Resolve routine choices from source and the established contract; ask only when
necessary information or a consequential decision remains unresolved.

This is a standalone Bun monorepo: `app/` is Expo, `wallet/` and `nostr/` are
private source packages, and `docs/` is the documentation site. Check Git status
before editing and preserve unrelated changes. Run commands from the directory
specified in SYSTEM.md; focused app Jest runs from `app/`, Knip from this root.
Never commit to `main` or push unless requested. Stage only intended changes.

Treat persisted field/enum changes as migrations. Preserve original structured
errors for payment control flow, keep secrets out of logs, and retain native
crypto/bootstrap and profile isolation. Consult the relevant SYSTEM.md decision
before changing these boundaries.

Skills are committed under `skills/`. Both `.agents/skills/` and `.claude/skills/`
contain relative links to those same files. No global skill installation or
parent workspace is required. Use `python3 skills/manage.py check` to verify the
installation; `python3 skills/manage.py link` repairs missing links. Prefer the
exact repository paths linked by SYSTEM.md if a personal skill shares a name.
Keep upstream snapshots unchanged; record refresh provenance in
`skills/sources.json`. Maintain app rules in SYSTEM.md, not in copied skills.
