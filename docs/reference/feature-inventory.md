# Feature inventory

Every capability Sovran ships today, organized by concern. Each item is either
**shipping** (`[x]`) or **recognized in the code but not yet enabled** (`[ ]`).
This reorganizes the claims in the app `README.md`; it does not add new ones.

## Payment rails

- [x] **Cashu ecash** — proofs, tokens, payment requests via `@cashu/cashu-ts`
  - [x] **P2PK receive** — NUT-10 well-known `P2PK` (NUT-11) tokens locked to your
    pubkey, unlocked automatically with the active profile's key
  - [x] **Cashu payment requests** (NUT-18) — amount, memo, accepted mints
  - [x] **Animated UR QR codes** — multi-frame UR sequences for oversized payloads
- [x] **Coco wallet engine** — `@cashu/coco-core` + `coco-expo-sqlite` + `coco-react`
- [x] **`wallet` package** — the send/receive/mint-select state machine on top of Coco
- [x] **Lightning** — BOLT-11, Lightning address (LUD-16), LNURL-pay (LUD-06)
- [x] **BIP-321** — `bitcoin:` URI for onchain + Lightning, extended with a `cashu`
  parameter; multi-rail fallback UI (onchain rail parsed and ranked but not sendable)
- [x] **Ecash send** — online recipient flows and offline handoff
  - [x] Online send (machine-driven), offline token handoff, share targets (QR,
    system share, NFC, BLE mesh), copy as text, copy as emoji
  - [x] **Pending-ecash sweeper** — mass-reclaim unclaimed outgoing tokens
- [x] **NPubCash (NPC)** — receive to an `npubx.cash` Lightning address

## Mint management & discovery

- [x] Multi-mint balances, mint rebalance planner (Split/Reset/Focus)
- [x] Auditor integration (uptime, swap success, latency) and auditor-driven discovery
- [x] Nostr mint reviews, mint state badges (`OK`/`DEGRADED`/`DOWN`), mint info screen
- [x] Mint selector with dimming, inactive-mint reclaim

## Nostr & identity

- [x] **Keys** — NIP-06 multi-account derivation, nsec import, multi-profile isolation
- [x] **Resolution** — NIP-05, NIP-05 on Lightning sends, Vertex credibility on rows
- [x] **DMs** — NIP-04 (legacy), NIP-17 private DMs (sealed/gift-wrapped, NIP-44 v2)
- [x] **Relays & search** — NDK Mobile, Nostr app-view (Nagg via the `nostr` package),
  Vertex trust-ranked search
- [x] **Feed** (`kind 1`) — home timeline (`kind 3`), threads, image overlay, video
  player, reactions (NIP-25), reposts (NIP-18), link parsing, image grid, ignore
  post/person
- [x] **Notifications & follows**, **unified cross-surface search**

## AI

- [x] **Routstr** — decentralized reverse proxy billing per request in Cashu
- [x] **Cashu-token top-up** — the wallet package mints a token deposited as Routstr balance
- [x] Model picker, streaming responses, AI chat as a tab, pull-to-AI, AI wallpaper

## BitChat (local BLE mesh)

- [x] Native iOS module, private DMs over BLE, group chats, geohash rooms,
  split-bill over BLE, **Nut Drop** (public ecash over BLE), BLE peer discovery in
  contacts, delivery acks, profile-scoped BLE identity

## Whitenoise

- [x] MLS-based E2E encrypted Nostr group chat (vendored `@internet-privacy/marmot-ts`):
  MLS group chats, key packages, invite-driven join, profile-scoped identity. Dev-gated.

## NFC

- [x] Tap to read / write / read-back; chunked writes, auto proof reclaim,
  dismiss-is-a-no-op; routed through the unified parser; bidirectional, online or offline

## Scanning & input

- [x] **Unified parser** for paste / scan / NFC / deeplink with ranked results
- [x] Recognized payloads: Cashu tokens (`cashuA`/`cashuB` + emoji), payment requests,
  BOLT-11, Lightning addresses, LNURL, BIP-21/BIP-321 URIs, on-chain addresses
  (parsed only), mint URLs, NIP-19 entities, `nsec`, animated UR QR
- [x] Gallery QR import, camera permission gating, flash control

## Deeplinks & URL schemes

- [x] Custom schemes (`bitcoin:`, `lightning:`, `lnurl:`, `cashu:`, `nostr:`,
  `web+nostr:`), `sovran://` routes, universal links (`https://sovran.money/…`),
  cross-wallet URI compatibility, modal-stacked profile opens

## Discovery

- [x] btcmaps.org merchants, map clustering, location-aware focus, search & filter,
  auditor- and Nostr-driven mint discovery

## Theme & visual

- [x] Wallpaper-driven theming, Nostr wallpaper sharing, hardened wallpaper pipeline,
  light & dark parity, Liquid Glass (iOS 26), capability variants, device-radius
  scene corners, mesh gradients, tile-pattern wallpaper

## Wallet & balance

- [x] Live BTC price, fiat-first amount entry, SAT/BTC/fiat switching, per-mint
  balance breakdown, transaction list (sectioned), month-pager, bulk pending sweep,
  transaction source badges, transaction location stamps (privacy-gated), status indicators

## Send & receive

- [x] Send-flow state machine, recipient identity enrichment, mint revalidation,
  token detail share screen, receive flow, Lightning melt, multi-rail fallback

## Split bill

- [x] Participant picker, per-person amount adjust, BLE-mesh settlement, NPC/Nostr
  settlement, settlement tracking

## Contacts

- [x] Unified search, reputation + followers on rows, BLE peers in contact list,
  mock contacts in demo mode

## Recovery & backup

- [x] BIP-39 mnemonic (single seed root), seed display & confirmation, restore from
  seed, `cashu-recovery`, `sovran-recover`, secure storage (`expo-secure-store`)

## iOS widgets

- [x] Two branded widgets (Bitcoin Pay, Sovran Pay), six widget families,
  tap-to-launch deeplink, adaptive rendering, pure SwiftUI Shape paths, iOS 16.4+

## Settings

- [x] Profile management, keyring, mint list & rebalance entry, fiat picker, theme
  settings, developer toggles, contact the developer

## Navigation & UX primitives

- [x] Expo Router, modal flow stacks, drawer + bottom tabs, `@gorhom/bottom-sheet`,
  `heroui-native`, project `Button`/`SelectableCheck` primitives, underline tabs,
  `number-flow-react-native`, `react-native-keyboard-controller`,
  `@shopify/flash-list` (v2) across feed/DMs/AI chat, Iconify + internal SVG
  namespace, design tokens, anchored color ramps, haptics, locale-aware dates

## Not yet shipped

- [ ] **On-chain send/receive rail** — addresses and BIP-321 onchain hints are
  parsed and ranked, but the rail is marked "Coming soon" and the send handler logs
  `onchainNotSupported`.
- [ ] **Production Android release** — Android config, EAS scripts, and fallbacks
  exist, but iOS remains the shipping target and some native features are iOS-only.
