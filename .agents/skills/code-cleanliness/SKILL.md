---
name: code-cleanliness
description: Run and interpret the Sovran code-quality gates (typecheck, lint, prettier, knip, jest) before committing. Use whenever you finish a change in sovran-app, are about to commit, or need to know why a gate is red.
---

# Code cleanliness (sovran-app)

`AGENTS.md` requires all gates to pass before any commit. Run them with `bun run`.

## The gates

| Gate | Command | What it catches |
|---|---|---|
| Types | `bun run type-check` | `tsc --noEmit`, strict. The fastest signal; run it first. |
| Lint | `bun run lint` | `eslint .` — custom rules: no `console`, no raw `fetch` (use `fetchJson`), no raw `Pressable`/`Animated`, no hardcoded hex (use `useThemeColor`/`brandColors`), no `Dimensions.get`, no `borderWidth: 0.5`, no `.toLocale*String`. |
| Format | `bun run pretty:check` | Prettier (100 col, single quote). `bun run pretty` to fix. |
| Dead code | `bun run knip` | Unused files/exports/deps. |
| Tests | `bun run test` | jest (jest-expo). |

Run the full suite before a commit. For a single change, the fast loop is:
`type-check`, then `eslint <changed files>` + `prettier --check <changed files>`,
then the relevant `jest <pattern>`. Run the FULL `lint`/`knip`/`test` before the commit.

## Suppressions baseline (important)

Pre-existing lint debt lives in `eslint-suppressions.json` (ESLint bulk
suppressions). Plain `eslint .` reads it automatically and only fails on NEW
violations. Two gotchas:

- After you FIX a previously-suppressed violation, `eslint .` fails with
  "suppressions left that do not occur anymore" — run
  `eslint . --prune-suppressions` to clean stale entries.
- Do not add NEW suppressions to dodge a rule in code you wrote — fix it. Only
  re-baseline (`eslint . --suppress-all --prune-suppressions`) when you have
  deliberately accepted pre-existing debt in files you did not author.

## Known traps (learned the hard way)

- **eslint can crash at config load**, not just report errors. `eslint-plugin-react-compiler`
  needs zod 3 but the repo `overrides` pin zod 4, so requiring it throws and kills the
  whole run. It's loaded defensively in `eslint.config.js`; if lint suddenly "crashes",
  check a plugin/zod-version mismatch, not your code.
- **knip only scans `**/*.{ts,tsx,js,jsx}`** (see `knip.json` `project`). `.mjs`
  scripts are invisible to it — don't add `.mjs` to the knip `entry` to "fix" a script,
  it only pulls unrelated `.mjs` into analysis (e.g. surfaces `jsonwebtoken`).
- **The npm-based skills CLI cannot run from this package** — the bun `overrides`
  (zod, neverthrow) conflict with npm and throw `EOVERRIDE`. Use bun, or run skills
  tooling from another directory.
- **`pretty:check` and the eslint `prettier/prettier` rule both run prettier** — if one
  is red the other usually is too; `bun run pretty` fixes both.

## When a gate is red

Read the first error, not the last. tsc/lint cascade — fixing the first often clears
many. If the red is in a file you did not touch, it is pre-existing debt: see the
suppressions baseline above; do not silently expand your change to fix unrelated files
unless asked.
