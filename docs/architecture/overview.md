# Architecture overview

Sovran is a single **Bun workspace** with four packages. The app depends on the
`wallet` and `nostr` packages via `workspace:*`; both ship raw TypeScript (no
build step), so there is no inter-package publishing and no version syncing.

```
Sovran (repo root = bun workspace)
├─ app/      Expo / React Native application (the product)
├─ wallet/   payment UX logic on top of Coco (formerly the colada repo)
├─ nostr/    Nostr app-view client + tiered data layer (formerly nagg-ts)
└─ docs/     this site (VitePress)
```

`@sovranbitcoin/schemas` stays an **external** package (shared with the web
properties) and resolves from GitHub Packages.

## App layout

- `app/app/` — Expo Router routes and route-group stacks (Stack → Drawer → Tabs;
  see [Navigation and routes](/protocols/navigation-and-routes)).
- `app/features/` — domain modules: wallet, send, receive, mint, transactions,
  feed, contacts, AI, map, split bill, settings, BitChat, Whitenoise, theme,
  onboarding.
- `app/shared/` — cross-cutting UI primitives, providers, stores, and
  Cashu/Nostr/NFC/Routstr helpers, theme and persistence infrastructure.
- `app/modules/` — local native modules (BitChat, Liquid Glass text).
- `app/targets/widget/` — iOS widget target via `@bacons/apple-targets`.
- `app/patches/` — native dependency patches applied by Bun via root `patchedDependencies`.

## Package boundaries

The `wallet` and `nostr` packages are UI- and navigation-agnostic. Platform
concerns reach them through injected adapters (clipboard, share, NFC, chain, QR
for wallet; tier connections for nostr) and through props/config — never by
importing app code.

## Signals for the packages

While documenting how the app consumes the packages, a few places surfaced where
the **app does work that arguably belongs in the package** — i.e. logic likely
needed by *every* consumer. These are candidates for upstreaming:

**`wallet`**

- **Real persisted history ids** — the app overrides `executeReceive` /
  `executeMintQuote` because the defaults synthesize fallback ids
  (`redeemed-${Date.now()}`) instead of returning Coco's real persisted ids,
  which breaks the transaction-detail link. Defaulting to real ids would remove
  the override from every consumer.
- **Mint catalog / NUT-06 caching** — the app reimplements cache-first/cache-only
  selection, per-mint deadline bounding, and write-through (~100 lines). This is
  generic mint-info plumbing that could live in the package with an injectable
  storage adapter.
- **Recipient profile stage 2** — NIP-05 → pubkey ships in the defaults, but
  hex-pubkey → kind-0 has no default, forcing every app to wire a Nostr fetch
  itself. A pluggable Nostr-fetch adapter would let the package own both stages.

**`nostr`**

- **Tier assembly from config** — translating enable/disable toggles into the
  nagg → Primal → relay tier list is generic wiring the package half-owns; a
  `facade.assembleTiers(config)` helper would belong in the package (only the
  profile-scoped memo + persistence are app concerns).
- **Profile-cache snapshot** — serialize/deserialize between the package's
  profile cache and a persisted snapshot reaches into package internals; a
  `toSnapshot()` / `ingestSnapshot()` pair would belong in the package.

These are observations for future work, not blockers.
