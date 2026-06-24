/**
 * @fileoverview Live Online/Offline status for the three Nostr data tiers, for
 * the Network settings screen.
 *
 * Composes an HTTP probe (nagg), a WebSocket round-trip probe (Primal), and the
 * caller-supplied NDK-pool relay health map into one uniform per-tier status.
 * The relay map is passed in (rather than calling `useRelayHealth` here) so the
 * screen runs a single relay poll for both the per-relay dots and this tier fold.
 *
 * Active probes run only while the screen is focused — on focus and then every
 * `POLL_INTERVAL_MS` — to bound battery/network cost; a disabled tier is not
 * probed (status `disabled`). Each run gets a fresh `AbortController`; starting a
 * new run (or blurring/unmounting) aborts the previous one, and a monotonic run
 * id drops any late result so it can't update state after the screen is gone.
 */
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { RelayHealth } from '@/shared/hooks/useRelayHealth';
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

export function useNostrTierHealth(relayMap: Record<string, RelayHealth>): NostrTierHealth {
  const config = useNostrTierConfig();

  const [nagg, setNagg] = useState<TierStatus>('checking');
  const [primal, setPrimal] = useState<TierStatus>('checking');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const relay: TierStatus = config.relay.enabled ? foldRelayStatus(relayMap) : 'disabled';

  const naggEnabled = config.nagg.enabled;
  const naggUrl = config.nagg.appViewBaseUrl;
  const primalEnabled = config.primal.enabled;
  const primalUrl = config.primal.url;

  const runProbes = useCallback(
    (trigger: 'focus' | 'interval' | 'pull') => {
      abortRef.current?.abort(); // cancel any still-running probe from a prior run
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runIdRef.current;
      log.debug('settings.network.health.refresh', { trigger });
      setIsRefreshing(true);

      setNagg((prev) => (naggEnabled ? toChecking(prev) : 'disabled'));
      setPrimal((prev) => (primalEnabled ? toChecking(prev) : 'disabled'));

      const naggTask: Promise<TierStatus> = naggEnabled
        ? probeNaggHealth(naggUrl, { signal: controller.signal }).match(
            (online) => (online ? 'online' : 'offline'),
            () => 'offline'
          )
        : Promise.resolve('disabled');
      const primalTask: Promise<TierStatus> = primalEnabled
        ? probePrimalHealth(primalUrl, { signal: controller.signal }).match(
            (online) => (online ? 'online' : 'offline'),
            () => 'offline'
          )
        : Promise.resolve('disabled');

      void Promise.all([naggTask, primalTask]).then(([naggStatus, primalStatus]) => {
        if (runId !== runIdRef.current) return; // a newer run (or cleanup) superseded this one
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
      return () => {
        clearInterval(interval);
        runIdRef.current++; // drop any in-flight result so it can't update state after blur
        abortRef.current?.abort();
      };
    }, [runProbes])
  );

  const refresh = useCallback(() => runProbes('pull'), [runProbes]);

  return { nagg, primal, relay, isRefreshing, refresh };
}
