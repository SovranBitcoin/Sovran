# Provider setup

The Nostr data layer is **not** a React context provider. It is assembled in one
place — `buildNostrDataLayer()` — a profile-scoped, memoised singleton. It reads
the Network-settings toggles, builds the enabled tiers (nagg → Primal → relay),
wraps them in `facade.createNostrDataLayer`, and shares one entity cache across
feed, thread, DM, and profile consumers. It rebuilds only on identity switch or a
tier-toggle change.

```ts
// app/shared/lib/nostr/buildNostrDataLayer.ts
import { createNaggClient, setNostrLogger, facade } from 'nostr';

function assembleLayer(config: TierConfig): facade.NostrDataLayer | null {
  const tiers: facade.NostrTierStrategy[] = [];

  if (config.nagg.enabled) {
    const client = createNaggClient({
      appView: { baseUrl: config.nagg.appViewBaseUrl, version: 'v1' },
    });
    tiers.push(facade.createNaggTier({ client }));
  }
  if (config.primal.enabled) {
    const connection = facade.primal.createPrimalWebSocketConnection({ url: config.primal.url });
    tiers.push(facade.primal.createPrimalTier({ connection }));
  }
  if (config.relay.enabled) {
    const connection = facade.relay.createRelayPoolConnection({ relays: [...config.relay.relays] });
    tiers.push(facade.relay.createRelayTier({ connection }));
  }
  if (tiers.length === 0) return null;
  return facade.createNostrDataLayer({ tiers });
}

// Memoised per active pubkey + tier-config. Consumers just call buildNostrDataLayer().
export function buildNostrDataLayer(): facade.NostrDataLayer | null {
  /* … */
}
```

Consumers (the feed client, thread hook, DM-envelope client, profile cache) call
`buildNostrDataLayer()` directly — no hook, no provider. Use `setNostrLogger` to
bridge the package's structured logs into the app logger.

## Key exports used

- `nostr` — `facade` (the data-layer surface: `createNostrDataLayer`,
  `createNaggTier`, `primal.*`, `relay.*`, and types like `NostrDataLayer`),
  `createNaggClient`, `setNostrLogger`.
- `nostr/recipes` — pre-built app-view query inputs/builders the feed client
  composes (`rankedFeedAppView`, `followsFeedAppView`, `threadAppView`,
  `notificationsAppView`, `dmConversationAppView`, …).
- `nostr/map` — wire→domain mappers (e.g. `NaggFeedPage`).
- `nostr/schemas` — Zod schemas for app-view payloads
  (`NaggFeedPageSchema`, `NaggThreadSchema`, …).
