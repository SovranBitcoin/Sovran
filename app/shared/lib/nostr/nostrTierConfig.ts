import { backendConfig } from '@/shared/config/backend';
import { log } from '@/shared/lib/logger';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

/**
 * Resolved configuration for the resilient Nostr data layer's two tiers
 * (Primal cache → raw relays), combining the enable/disable toggles
 * (Settings → Network) with the endpoint config.
 */
export type NostrTierConfig = {
  primal: { enabled: boolean; urls: readonly string[] };
  relay: { enabled: boolean; relays: readonly string[] };
};

let lastLoggedConfigKey: string | null = null;

function enabledPrimalUrls(disabled: readonly string[]): string[] {
  return backendConfig.primalCacheUrls.filter((url) => !disabled.includes(url));
}

export function getNostrTierConfig(): NostrTierConfig {
  const s = useSettingsStore.getState();
  const config: NostrTierConfig = {
    primal: (() => {
      const urls = enabledPrimalUrls(s.primalHostsDisabled);
      return { enabled: s.primalTierEnabled && urls.length > 0, urls };
    })(),
    relay: { enabled: s.relayTierEnabled, relays: DEFAULT_RELAYS },
  };
  const configKey = [
    config.primal.enabled,
    config.relay.enabled,
    config.primal.urls.join(','),
    config.relay.relays.length,
  ].join('|');
  if (configKey !== lastLoggedConfigKey) {
    lastLoggedConfigKey = configKey;
    log.info('nostr.tierConfig.resolved', {
      enabled: [
        config.primal.enabled ? 'primal' : null,
        config.relay.enabled ? 'relay' : null,
      ].filter(Boolean),
      primalUrls: config.primal.urls,
      relays: config.relay.relays.length,
    });
  }
  return config;
}

/** Reactive hook form for components that want to display tier state. */
export function useNostrTierConfig(): NostrTierConfig {
  const primalTierEnabled = useSettingsStore((st) => st.primalTierEnabled);
  const relayTierEnabled = useSettingsStore((st) => st.relayTierEnabled);
  const primalHostsDisabled = useSettingsStore((st) => st.primalHostsDisabled);
  const primalUrls = enabledPrimalUrls(primalHostsDisabled);
  return {
    primal: {
      enabled: primalTierEnabled && primalUrls.length > 0,
      urls: primalUrls,
    },
    relay: { enabled: relayTierEnabled, relays: DEFAULT_RELAYS },
  };
}
