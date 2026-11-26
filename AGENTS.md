# Sovran app

A Bitcoin and ecash wallet: an Expo app with its own `wallet/` and `nostr/` packages. People keep
money in it, so losing saved data or mishandling a payment is the worst outcome.

The owner's instructions come first, then this file. Never add dependencies, push, publish,
commit to `main`, or run destructive actions without explicit go-ahead.

## Core rules

1. **Code is the source of truth.** Read the code and relevant ADRs in [app/docs/adr](app/docs/adr)
   before changing behaviour. Keep comments concise and accurate; avoid adding extra markdown docs.
2. **Reuse, then delete, then add.** Extend existing helpers and delete replaced code in the same
   commit. Change only what the task names.
3. **Never break persisted user data.** Do not rename a store, storage key, secure key or SQLite
   database, and do not rename, remove or tighten a saved field — old installs would drop the whole
   store. Add fields with defaults without bumping versions, and verify all 20 release upgrade
   epochs with `bun run --cwd app test:upgrade`.
4. **Prove every change.** Run `bun run check` (or the relevant workspace checks below). For UI
   changes, inspect them running on screen. State clearly what was verified and what was not.
5. **Commit in small logical steps.** Keep PR descriptions current and ending with
   `<!-- describes <head sha> -->`.
6. **Track unfinished work** in [docs/follow-ups](docs/follow-ups/README.md), not `TODO` comments.

## Layout

| Path | Owns |
| --- | --- |
| `app/` | Expo app: routes (`app/app`), features (`app/features`), shared UI, hooks, stores & infra (`app/shared`) |
| `wallet/` | Payment intent, sequencing, operations, payment copy, and `wallet/react` |
| `nostr/` | Pure `nostr-tools` client, relay transport, Primal/relay tiers, and entity cache |
| `copy/` | Shared wording, legal text, claims rules |
| `site/`, `press/`, `docs/` | Website, marketing assets, and documentation |
| `release/` | Release pipeline |

Imports flow `app → wallet → nostr` and `app → nostr`; `wallet` and `nostr` never import `app`.
Mint proofs and wallet state belong to Coco (`@cashu/coco-core`); wire schemas to `@sovranbitcoin/schemas`.

## Checks

Install at the root with Bun and the committed `bun.lock`.

| Where | Command | Checks |
| --- | --- | --- |
| root | `bun run check` | Type-check, lint, knip, copy:lint, followups, rebuild:metrics, all tests |
| root | `bun run type-check` | Every workspace (app for iOS and Android) |
| root | `bun run test` | Wallet & Nostr (Vitest), app (Jest) |
| `app/` | `bun run test:upgrade` | All 20 persisted release upgrade epochs (`E01`–`E20`) |
| `app/` | `bun run lint`, `bun run check:styling`, `bun run check:react-compiler`, `bun run check:glass-headers` | ESLint, styling, React Compiler, and glass header ratchets |
| `app/` | `bun run e2e:test` | Native page registry and E2E helper tests |
| root | `bun run knip`, `bun run copy:lint`, `bun run followups check`, `bun run rebuild:metrics` | Unused code, copy claims, follow-ups, and size/dep ratchet |

`storeRegistryManifest.ts` is generated via `bun run --cwd app store-registry:update` — never
hand-edit it. Patch dependencies only via `bun patch` / `bun patch --commit` and document each in
[app/patches/README.md](app/patches/README.md).
