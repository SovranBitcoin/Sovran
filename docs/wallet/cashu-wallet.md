# Cashu wallet

Sovran's wallet is layered:

- **Coco** (`@cashu/coco-core` + `@cashu/coco-expo-sqlite` + `@cashu/coco-react`) —
  the headless TypeScript Cashu engine: proof storage, swaps, and reactive state.
  Coco owns the seed.
- **The `wallet` package** (formerly `colada`) — payment UX logic on top of Coco:
  parsing, classification, routing, the send/receive state machine, screen
  actions, guards, LNURL/NIP-05 resolution, and offline suggestions. It is UI- and
  navigation-agnostic and receives platform concerns through adapters.
- **The app** — mounts the provider, renders screens, and supplies platform
  adapters (clipboard, share, NFC, chain, QR) and the `walletContext` (trusted
  mints + balances).

## What ships

- **Cashu ecash** — proofs, tokens, and payment requests via `@cashu/cashu-ts`.
  - **P2PK receive** — tokens whose proofs carry a NUT-10 well-known secret of
    kind `P2PK` (NUT-11), locked to your pubkey and unlocked automatically with
    the active profile's key.
  - **Cashu payment requests** (NUT-18) — request-driven flow with amount, memo,
    and accepted mints (`creqA…` / `creqB…`).
  - **Animated UR QR codes** — multi-frame UR sequences for oversized payloads.
- **Coco wallet engine** — proof storage, swaps, and reactive balance.
- **Lightning** — BOLT-11 pay-to-invoice via mint melt quotes, Lightning
  addresses (LUD-16), and LNURL-pay (LUD-06). See [Lightning](/payments/lightning).
- **Ecash send** — online recipient flows and offline handoff (QR, system share,
  NFC, BLE mesh), copy as text or emoji, and a pending-ecash sweeper.
- **NPubCash (NPC)** — receive to an `npubx.cash` Lightning address.
- **Multi-mint** — balances across many mints, mint rebalance, auditor and Nostr
  mint discovery, and mint state badges.

## How to use it

- [Provider setup](/wallet/provider-setup) — mounting the wallet provider.
- [Receiving](/wallet/receiving) — mint quotes and redeeming tokens.
- [Sending](/wallet/sending) — ecash and Lightning sends.
- [Error handling](/wallet/error-handling) — how failures surface to screens.
