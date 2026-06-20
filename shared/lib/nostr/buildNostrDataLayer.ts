import { createNaggClient, setNostrLogger, facade, type NostrLogger } from '@sovranbitcoin/nagg-ts';

import { backendConfig } from '@/shared/config/backend';
import { log } from '@/shared/lib/logger';
import { getNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';

// ---------------------------------------------------------------------------
// Builds the tier-selecting Nostr data-layer facade from the live config +
// dev tier toggles (Settings → Network). A disabled tier is omitted from the
// nagg → Primal → relay fallback chain, so the toggles actually change which
// source serves a read.
//
// NOTE (local-dev proof): this imports the facade from @sovranbitcoin/nagg-ts.
// The facade only exists in the LOCAL (symlinked) nagg-ts; the published
// registry 0.5.0 predates it, so an EAS/release build will fail to resolve
// these symbols until nagg-ts is published. Local dev is fine.
// ---------------------------------------------------------------------------

let loggerBridged = false;

/** Route nagg-ts's structured logs into the app logger so the tier trace is visible. */
function bridgeNostrLoggerOnce(): void {
  if (loggerBridged) return;
  loggerBridged = true;
  const bridge: NostrLogger = {
    debug: (event, data) => log.debug(event, data),
    info: (event, data) => log.info(event, data),
    warn: (event, data) => log.warn(event, data),
  };
  setNostrLogger(bridge);
}

/**
 * Build a facade whose tiers reflect the current enable/disable toggles.
 * Returns null when every tier is disabled (nothing can serve a read).
 */
export function buildNostrDataLayer(): facade.NostrDataLayer | null {
  bridgeNostrLoggerOnce();
  const config = getNostrTierConfig();

  const tiers: facade.NostrTierStrategy[] = [];

  if (config.nagg.enabled) {
    const client = createNaggClient({
      endpoint: backendConfig.nostrGraphqlEndpoint,
      appView: { baseUrl: config.nagg.appViewBaseUrl, version: 'v1' },
      transport: 'appview',
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

  if (tiers.length === 0) {
    log.warn('nostr.facade.no_tiers_enabled');
    return null;
  }
  return facade.createNostrDataLayer({ tiers });
}
