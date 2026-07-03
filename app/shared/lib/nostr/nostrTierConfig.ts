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
export type NostrTierConfig = {
  nagg: { enabled: boolean; appViewBaseUrl: string };
  primal: { enabled: boolean; url: string };
  relay: { enabled: boolean; relays: readonly string[] };
};

// getNostrTierConfig is called on every facade read and transport poll —
// hundreds of times per session. Log only when the resolved config actually
// changes (boot + toggle flips), not once per resolution.
let lastLoggedConfigKey: string | null = null;

export function getNostrTierConfig(): NostrTierConfig {
  const s = useSettingsStore.getState();
  const config: NostrTierConfig = {
    nagg: { enabled: s.naggTierEnabled, appViewBaseUrl: backendConfig.nostrAppViewBaseUrl },
    primal: { enabled: s.primalTierEnabled, url: backendConfig.primalCacheUrl },
    relay: { enabled: s.relayTierEnabled, relays: DEFAULT_RELAYS },
  };
  const configKey = [
    config.nagg.enabled,
    config.primal.enabled,
    config.relay.enabled,
    config.nagg.appViewBaseUrl,
    config.primal.url,
    config.relay.relays.length,
  ].join('|');
  if (configKey !== lastLoggedConfigKey) {
    lastLoggedConfigKey = configKey;
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
  }
  return config;
}

/** Reactive hook form for components that want to display tier state. */
export function useNostrTierConfig(): NostrTierConfig {
  const naggTierEnabled = useSettingsStore((st) => st.naggTierEnabled);
  const primalTierEnabled = useSettingsStore((st) => st.primalTierEnabled);
  const relayTierEnabled = useSettingsStore((st) => st.relayTierEnabled);
  return {
    nagg: { enabled: naggTierEnabled, appViewBaseUrl: backendConfig.nostrAppViewBaseUrl },
    primal: { enabled: primalTierEnabled, url: backendConfig.primalCacheUrl },
    relay: { enabled: relayTierEnabled, relays: DEFAULT_RELAYS },
  };
}
