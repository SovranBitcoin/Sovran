import { backendConfig } from '@/shared/config/backend';
import { log } from '@/shared/lib/logger';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

/**
 * Resolved configuration for the resilient Nostr data layer's three tiers
 * (nagg → Primal cache → raw relays), combining the dev enable/disable toggles
 * (Settings → Developer) with the endpoint config. This is the single seam the
 * facade wiring reads when the read paths are routed through `@sovranbitcoin/
 * nagg-ts` — a disabled tier is simply omitted from the fallback chain, so a
 * developer can simulate "nagg down" / "Primal down" / "relays down".
 *
 * It deliberately holds NO reference to the facade itself (only plain config),
 * so it ships safely while the app still resolves nagg-ts to the published
 * registry version that predates the facade.
 */
type NostrTierConfig = {
  nagg: { enabled: boolean; appViewBaseUrl: string };
  primal: { enabled: boolean; url: string };
  relay: { enabled: boolean; relays: readonly string[] };
};

export function getNostrTierConfig(): NostrTierConfig {
  const s = useSettingsStore.getState();
  const config: NostrTierConfig = {
    nagg: { enabled: s.naggTierEnabled, appViewBaseUrl: backendConfig.nostrAppViewBaseUrl },
    primal: { enabled: s.primalTierEnabled, url: backendConfig.primalCacheUrl },
    relay: { enabled: s.relayTierEnabled, relays: DEFAULT_RELAYS },
  };
  log.info('nostr.tierConfig.resolved', {
    enabled: [
      config.nagg.enabled ? 'nagg' : null,
      config.primal.enabled ? 'primal' : null,
      config.relay.enabled ? 'relay' : null,
    ].filter(Boolean),
    naggUrl: config.nagg.appViewBaseUrl,
    primalUrl: config.primal.url,
    relays: config.relay.relays.length,
  });
  return config;
}
