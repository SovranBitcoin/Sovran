# Start here

Sovran is a Bitcoin wallet for **Cashu ecash, Lightning, and offline payments**,
built with Expo and React Native. It ships first on iOS (minimum iOS 16.4);
Android configuration and fallbacks exist in the codebase but iOS is the
production target.

The app combines:

- **Coco wallet state** — `@cashu/coco-core` + `@cashu/coco-expo-sqlite` for proof
  storage, swaps, and reactive balance.
- **Nostr identity & payment DMs** — NIP-06 multi-account keys, NIP-17 encrypted
  payment messages, and contact/profile lookup through the in-repo `nostr` package.
- **NFC tag handoffs** and the **BitChat BLE mesh** for offline payments.

On-chain Bitcoin inputs are recognized by the parser and BIP-321 ranking, but
on-chain send and receive are **not shipped yet**.

## The monorepo

The repository is a single Bun workspace with four packages:

| Package    | What it is |
|------------|------------|
| `app/`     | The Expo / React Native application. |
| `wallet/`  | Payment UX logic on top of Coco — parsing, classification, routing, the send/receive state machine, offline suggestions. UI- and navigation-agnostic. |
| `nostr/`   | Direct Nostr client (`nostr-tools`), relay pool, NIP-17 transport, and tiered data layer. |
| `docs/`    | This site. |

`app` depends on `wallet` and `nostr` via `workspace:*`; both ship raw TypeScript
(no build step). See [Architecture overview](/architecture/overview) for how the
pieces fit together.

## Where to go next

- [Install and run](/starting/install-and-run) — get a build running locally.
- [Cashu wallet](/wallet/cashu-wallet) — how the wallet engine and packages work.
- [Send and receive](/payments/send-receive) — the payment flow.
- [Feature inventory](/reference/feature-inventory) — everything Sovran ships today.
