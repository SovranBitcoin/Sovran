/**
 * @fileoverview Live Online/Offline status for the three Nostr data tiers, for
 * the Network settings screen.
 *
 * Composes an HTTP probe (nagg), a WebSocket round-trip probe (Primal), and the
 * existing NDK-pool relay health (`useRelayHealth`) into one uniform per-tier
 * status. Active probes run only while the screen is focused — on focus and then
 * every `POLL_INTERVAL_MS` — to bound battery/network cost; a disabled tier is
 * not probed (its status is `disabled`). A monotonic run id guards against a
 * slow probe from an earlier run overwriting a newer result.
 */
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useRelayHealth } from '@/shared/hooks/useRelayHealth';
import { log } from '@/shared/lib/logger';
import { useNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import {
  foldRelayStatus,
  probeNaggHealth,
  probePrimalHealth,
  type TierStatus,
} from '@/shared/lib/nostr/tierHealth';

const POLL_INTERVAL_MS = 30_000;

interface NostrTierHealth {
  nagg: TierStatus;
  primal: TierStatus;
  relay: TierStatus;
  isRefreshing: boolean;
  refresh: () => void;
}

/** Keep the last known online/offline during a refresh; only show `checking`
 * when transitioning from a `disabled` (or initial) state, to avoid flicker. */
function toChecking(prev: TierStatus): TierStatus {
  return prev === 'disabled' ? 'checking' : prev;
}

export function useNostrTierHealth(): NostrTierHealth {
  const config = useNostrTierConfig();
  const relayMap = useRelayHealth();

  const [nagg, setNagg] = useState<TierStatus>('checking');
  const [primal, setPrimal] = useState<TierStatus>('checking');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const runIdRef = useRef(0);

  const relay: TierStatus = config.relay.enabled ? foldRelayStatus(relayMap) : 'disabled';

  const naggEnabled = config.nagg.enabled;
  const naggUrl = config.nagg.appViewBaseUrl;
  const primalEnabled = config.primal.enabled;
  const primalUrl = config.primal.url;

  const runProbes = useCallback(
    (trigger: 'focus' | 'interval' | 'pull') => {
      const runId = ++runIdRef.current;
      log.debug('settings.network.health.refresh', { trigger });
      setIsRefreshing(true);

      setNagg((prev) => (naggEnabled ? toChecking(prev) : 'disabled'));
      setPrimal((prev) => (primalEnabled ? toChecking(prev) : 'disabled'));

      const naggTask: Promise<TierStatus> = naggEnabled
        ? probeNaggHealth(naggUrl).match(
            (online) => (online ? 'online' : 'offline'),
            () => 'offline'
          )
        : Promise.resolve('disabled');
      const primalTask: Promise<TierStatus> = primalEnabled
        ? probePrimalHealth(primalUrl).match(
            (online) => (online ? 'online' : 'offline'),
            () => 'offline'
          )
        : Promise.resolve('disabled');

      void Promise.all([naggTask, primalTask]).then(([naggStatus, primalStatus]) => {
        if (runId !== runIdRef.current) return; // a newer run superseded this one
        setNagg(naggStatus);
        setPrimal(primalStatus);
        setIsRefreshing(false);
        log.info('settings.network.health.probe', { tier: 'nagg', status: naggStatus });
        log.info('settings.network.health.probe', { tier: 'primal', status: primalStatus });
      });
    },
    [naggEnabled, naggUrl, primalEnabled, primalUrl]
  );

  useFocusEffect(
    useCallback(() => {
      runProbes('focus');
      const interval = setInterval(() => runProbes('interval'), POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [runProbes])
  );

  const refresh = useCallback(() => runProbes('pull'), [runProbes]);

  return { nagg, primal, relay, isRefreshing, refresh };
}
