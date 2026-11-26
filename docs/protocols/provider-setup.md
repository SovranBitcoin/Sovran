# Provider setup

Sovran owns its Nostr transport directly in the in-repo `nostr` package
(`nostr/client` for `NostrClient`, `RelayPool`, and `LocalSigner`, plus `nostr`
for the tiered `facade.NostrDataLayer`).

- **`NostrClient` (`app/shared/lib/nostr/nostrClientSingleton.ts`)** — profile-scoped
  singleton wrapping `nostr-tools` WebSocket relay connections, signing, NIP-44
  encryption, and live NIP-17 payment inbox subscriptions.
- **`buildNostrDataLayer()` (`app/shared/lib/nostr/buildNostrDataLayer.ts`)** —
  profile-scoped memoised singleton that builds the enabled read tiers
  (Primal → direct relay) and shares one entity cache across profile, contact,
  and payment consumers. It rebuilds on identity switch or tier-toggle change.

Consumers call `getNostrClient()` or `buildNostrDataLayer()` directly — no React
context provider is required. Use `setNostrLogger` to bridge the package's
structured logs into the app logger.

## Key exports used

- `nostr/client` — `createNostrClient`, `createLocalSigner`, `RelayPool`,
  `normalizeRelayUrl`, NIP-17 / NIP-44 helpers.
- `nostr` — `facade` (`createNostrDataLayer`, `primal.*`, `relay.*`, and
  `NostrDataLayer`), `setNostrLogger`.
