# Sovran app

A Bitcoin and ecash wallet: an Expo app with its own wallet and Nostr packages. People keep
money in it, so a change that loses saved data or mishandles a payment is the worst outcome.

The owner's current instructions come first, then this file, then anything a skill says.
Skills never authorize new dependencies, external messages, publishing, commits to `main`,
pushes or destructive actions.

## How work runs here

1. **Understand before changing.** Read the code and the relevant doc in the table below.
   When deciding how the wallet treats a mint, a payment or another wallet, also check peers
   (`../../coco`, `../../cashu-ts`, `../../cdk`, `../../nutshell`, `../../cashu.me`,
   `../../minibits_wallet`, `../../eNuts`, `../../Numo`) and `../../nuts` as common practice.
2. **Plan multi-commit changes** in plain words about what the person using the app sees.
3. **Reuse, then delete, then add.** Extend the existing helper or store; delete what your
   change replaces in the same commit. Change only what the task names.
4. **Prove it.** Run `bun run check` (or the relevant workspace checks below). For UI changes,
   inspect them running on screen. State clearly what was verified and what was not.
5. **Commit in small logical steps.** After each commit that changes behaviour, run
   `audit-commit` on it and fix verified issues in a new commit.
6. **Keep the pull request true.** After every push to a branch with an open pull request,
   rewrite its title and description to cover everything on the branch, ending with
   `<!-- describes <head sha> -->`.
7. **Write down what you leave.** Unfinished work goes in
   [docs/follow-ups](docs/follow-ups/README.md), never in a `TODO` comment.

Use helpers in parallel for reading, searching and independent review (especially on money,
keys, saved data and migrations). One agent writes at a time. Check Git status before editing
and use a `git worktree` rather than switching branches or stashing another session's work.

## Read before you change

| Changing | Read | Then |
| --- | --- | --- |
| Anything | [Conventions](docs/review/contributor-conventions.md); relevant ADRs in [app/docs/adr](app/docs/adr) | Record significant decisions as a new ADR |
| A screen or component | [Building a screen](docs/review/building-screens.md) | `bun run check:styling`; inspect running UI |
| A route, sheet or flow | [Navigation and routes](docs/protocols/navigation-and-routes.md) | Register the page in `app/e2e/schema` |
| Saved state, keys, SQLite or migrations | [Account lifecycle](docs/architecture/account-lifecycle.md); [state conventions](docs/review/conventions-state.md) | Run `persistence-release-safety` and `bun run test:upgrade` |
| Payments, keys, Nostr signing, `wallet/`, Coco | [Architecture overview](docs/architecture/overview.md); [contracts](docs/review/contracts.md); [entropy](docs/review/entropy.md) | Keep Coco patches minimal ([app/patches](app/patches/README.md)) |
| Wording people read | `copy/` and [CLAIMS.md](CLAIMS.md) | `bun run copy:lint` |
| A release | [release/README.md](release/README.md) | `persistence-release-safety` and release fixture step |

Do not rename a store, storage key, secure key or database, and do not rename, remove or
tighten a saved field: an old install whose saved data no longer parses loses that whole store.
Add fields with a default, without a version bump.

## Layout

| Path | Owns |
| --- | --- |
| `app/` | Expo app: routes (`app/app`), features (`app/features`), shared UI, hooks, stores & infra (`app/shared`) |
| `wallet/` | Payment intent, sequencing, operations, payment copy, and `wallet/react` |
| `nostr/` | Pure `nostr-tools` client, relay transport, Primal/relay tiers, and entity cache |
| `copy/` | Shared wording, legal text, claims rules |
| `docs/`, `site/`, `press/` | Documentation, website, marketing assets |
| `release/` | Release pipeline |

Imports flow `app → wallet → nostr` and `app → nostr`; `wallet` and `nostr` never import `app`.
Mint proofs and wallet state belong to Coco; wire contracts to `@sovranbitcoin/schemas`.

## Checks

Install at the root with Bun and the committed `bun.lock`.

| Where | Command | Checks |
| --- | --- | --- |
| root | `bun run check` | Type-check, lint, knip, copy:lint, followups, rebuild:metrics, all tests |
| root | `bun run type-check` | Every workspace; app for iOS and Android |
| root | `bun run test` | Wallet and Nostr (Vitest), app (Jest) |
| `app/` | `bun run test:upgrade` | All 20 persisted release upgrade epochs (`E01`–`E20`) |
| `app/` | `bun run lint`, `bun run check:styling`, `bun run check:react-compiler`, `bun run check:glass-headers` | ESLint, styling, React Compiler, and glass header ratchets |
| `app/` | `bun run e2e:test` | Native page registry and E2E helper tests |
| root | `bun run knip`, `bun run copy:lint`, `bun run followups check`, `bun run rebuild:metrics` | Unused code, copy claims, follow-ups, and size/dep ratchet |

`storeRegistryManifest.ts` is generated: regenerate via `bun run --cwd app store-registry:update`,
never hand-edit. For native, config, patch or import changes, build both Metro platform bundles.
Never run a destructive or funded scenario against a real wallet.

## Native testability

Register new or changed pages in `CANONICAL_PAGES` and `PAGE_ROUTES` (`app/e2e/schema`), give
interactive controls a stable `testID` and accessible label, and expose non-visible state via
`E2EAccessibilityProbe`.

## Patches

Patch packages with `bun patch` and `bun patch --commit`, never by editing installed files.
Document each patch's purpose, test and removal trigger in [app/patches/README.md](app/patches/README.md).

## Repo skills

Sovran-specific skills live in `.agents/skills/` (linked from `.claude/skills/`):

| Skill | When |
| --- | --- |
| `audit-commit` | After each commit that changes behaviour, or when auditing a commit |
| `persistence-release-safety` | Before and after any change to saved data, storage libraries, or releases |

Verify skill links with `python3 .agents/skills/manage.py check` (`link` repairs them).
