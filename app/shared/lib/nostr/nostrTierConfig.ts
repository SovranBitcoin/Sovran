import { backendConfig } from '@/shared/config/backend';
import { log } from '@/shared/lib/logger';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

/**
 * Resolved configuration for the resilient Nostr data layer's three tiers
 * (nagg → Primal cache → raw relays), combining the enable/disable toggles
 * (Settings → Network) with the endpoint config. This is the single seam the
 * facade wiring reads when the read paths are routed through the `nostr`
 * workspace package — a disabled tier is simply omitted from the fallback
 * chain, so "nagg down" / "Primal down" / "relays down" can be simulated.
 *
 * It deliberately holds NO reference to the facade itself, only plain config.
 */
export type NostrTierConfig = {
  nagg: { enabled: boolean; appViewBaseUrl: string };
  primal: { enabled: boolean; urls: readonly string[] };
  relay: { enabled: boolean; relays: readonly string[] };
};

// getNostrTierConfig is called on every facade read and transport poll —
// hundreds of times per session. Log only when the resolved config actually
// changes (boot + toggle flips), not once per resolution.
let lastLoggedConfigKey: string | null = null;

/**
 * The cache hosts still switched on, in their configured order.
 *
 * `primalHostsDisabled` is a denylist, so an unknown or stale entry simply
 * matches nothing — it can never disable a host the user can still see. Turning
 * every host off is the same as turning the tier off, and is reported that way
 * rather than handing the connection an empty list.
 */
function enabledPrimalUrls(disabled: readonly string[]): string[] {
  return backendConfig.primalCacheUrls.filter((url) => !disabled.includes(url));
}

export function getNostrTierConfig(): NostrTierConfig {
  const s = useSettingsStore.getState();
  const config: NostrTierConfig = {
    nagg: { enabled: s.naggTierEnabled, appViewBaseUrl: backendConfig.nostrAppViewBaseUrl },
    primal: (() => {
      const urls = enabledPrimalUrls(s.primalHostsDisabled);
      return { enabled: s.primalTierEnabled && urls.length > 0, urls };
    })(),
    relay: { enabled: s.relayTierEnabled, relays: DEFAULT_RELAYS },
  };
  const configKey = [
    config.nagg.enabled,
    config.primal.enabled,
    config.relay.enabled,
    config.nagg.appViewBaseUrl,
    config.primal.urls.join(','),
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
      primalUrls: config.primal.urls,
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
  const primalHostsDisabled = useSettingsStore((st) => st.primalHostsDisabled);
  const primalUrls = enabledPrimalUrls(primalHostsDisabled);
  return {
    nagg: { enabled: naggTierEnabled, appViewBaseUrl: backendConfig.nostrAppViewBaseUrl },
    primal: {
      enabled: primalTierEnabled && primalUrls.length > 0,
      urls: primalUrls,
    },
    relay: { enabled: relayTierEnabled, relays: DEFAULT_RELAYS },
  };
}
