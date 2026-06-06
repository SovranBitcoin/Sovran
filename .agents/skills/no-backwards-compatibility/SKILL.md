---
name: no-backwards-compatibility
description: Stop adding backwards-compatibility cruft (shims, aliases, fallbacks, dead code) for behaviour that never shipped. Use when a change alters an API/shape/flow, when reviewing a diff for compatibility cruft, or when tempted to "keep the old path just in case".
---

# No backwards compatibility (unless it shipped)

Sovran is a mobile app shipped as a built binary, plus three libraries
(`colada`, `nagg-ts`, and the `nagg` server) that are **consumed only by
Sovran**. There are almost no external consumers, and unstaged code is only on
the local machine. So the default is: **change the thing and update every caller.
Do not preserve behaviour that never reached users.**

## Policy

Default: do NOT add backwards-compatibility code. Specifically do not add:
compatibility shims, legacy aliases, re-exports for old names, fallback code
paths, deprecated wrappers, migration code for unreleased schemas, feature flags
whose only purpose is preserving unshipped behaviour, or dead code kept "just in
case".

Compatibility is valid ONLY for a shipped or merge-visible contract. Consider it
only when ALL of these hold:
1. The old API / behaviour / data shape / config / file format reached `main`,
   OR shipped in a release / deployment / package / persisted-data format.
2. There is a plausible client/user of that version (for the app: an installed
   build; for a library: a published version some consumer pins).
3. The change names what is being protected: release/tag, deployed client,
   persisted-data migration, published package version, or production consumer.
4. The compatibility path has a removal plan / expiry.

If the old behaviour only existed on a feature branch, draft PR, prototype, local
test, or agent-generated intermediate state, it is NOT a contract. Delete the old
path and update all call sites.

## Sovran specifics

- **Persisted data (Zustand `persist`, SQLite) IS a shipped contract** once an
  install has it. Change the persisted shape with a `version` bump + `migrate`
  (see `__rules__/caching.md`), not a shim. This is the main legitimate case.
- **colada / nagg-ts / nagg are Sovran-only.** When you change one of them, just
  update Sovran and republish — no deprecation window, no dual API. (A published
  package version another local checkout pins is the only nuance: bump it.)
- **The app itself**: code not yet on `main`/not in a store build has zero users.
  Refactor freely; do not "preserve" branch-only behaviour.

## How to tell what shipped

- App version + store builds: `app.json` `version` + iOS `buildNumber` + Android
  `versionCode`; EAS `production` profile (`eas.json`); git tags. A behaviour is
  "shipped" if it's in a commit that produced a production build (version/build
  bump merged to `main`).
- Library: the version in the consumer's lockfile / `package.json` range.
- Persisted shape: assume shipped if any released build wrote it.

## Review checklist (run on a diff)

Grep the diff for: `fallback`, `legacy`, `deprecat`, `compat`, `shim`, `alias`,
`re-export`, `old`, `// keep for`. For each hit, ask: does it protect something
that reached `main`/a release/persisted data? If not — delete it, update callers.
A persisted-shape change without a `version`+`migrate` is the inverse bug (a
silent break) — that one DOES need handling.
