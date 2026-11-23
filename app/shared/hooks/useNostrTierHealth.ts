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
import { useForegroundFocusEffect } from '@/shared/hooks/useForegroundFocusEffect';

import type { RelayHealth } from '@/shared/hooks/useRelayHealth';
import { log } from '@/shared/lib/logger';
import { useNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import {
  foldRelayStatus,
  probePrimalHealth,
  type TierStatus,
} from '@/shared/lib/nostr/tierHealth';

const POLL_INTERVAL_MS = 30_000;

interface NostrTierHealth {
  primal: TierStatus;
  /**
   * Per-host status for the Primal tier, keyed by url. The tier fold above says
   * whether ANY host answered; this says which one, so a page listing the hosts
   * can show a dead one instead of a green tier hiding it.
   */
  primalHosts: Record<string, TierStatus>;
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

  const [primal, setPrimal] = useState<TierStatus>('checking');
  const [primalHosts, setPrimalHosts] = useState<Record<string, TierStatus>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const relay: TierStatus = config.relay.enabled ? foldRelayStatus(relayMap) : 'disabled';

  const primalEnabled = config.primal.enabled;
  // Identity for the deps array — the list itself is rebuilt on every config
  // read, so `runProbes` reads the hosts back from this key.
  const primalUrlKey = config.primal.urls.join(',');

  const runProbes = useCallback(
    (trigger: 'focus' | 'interval' | 'pull') => {
      abortRef.current?.abort(); // cancel any still-running probe from a prior run
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runIdRef.current;
      const primalUrls = primalUrlKey ? primalUrlKey.split(',') : [];
      log.debug('settings.network.health.refresh', { trigger });
      if (trigger === 'pull') setIsRefreshing(true);

      setPrimal((prev) => (primalEnabled ? toChecking(prev) : 'disabled'));

      const probeEachHost = async (): Promise<Record<string, TierStatus>> => {
        const entries = await Promise.all(
          primalUrls.map(async (url): Promise<[string, TierStatus]> => {
            if (controller.signal.aborted) return [url, 'offline'];
            const online = await probePrimalHealth(url, { signal: controller.signal }).match(
              (reachable) => reachable,
              () => false
            );
            return [url, online ? 'online' : 'offline'];
          })
        );
        return Object.fromEntries(entries);
      };
      const primalTask: Promise<Record<string, TierStatus>> = primalEnabled
        ? probeEachHost()
        : Promise.resolve(Object.fromEntries(primalUrls.map((url) => [url, 'disabled' as const])));

      void primalTask.then((hostStatuses) => {
        if (runId !== runIdRef.current) return; // a newer run (or cleanup) superseded this one
        const statuses = Object.values(hostStatuses);
        const primalStatus: TierStatus = !primalEnabled
          ? 'disabled'
          : statuses.includes('online')
            ? 'online'
            : 'offline';
        setPrimal(primalStatus);
        setPrimalHosts(hostStatuses);
        setIsRefreshing(false);
        log.info('settings.network.health.probe', {
          tier: 'primal',
          status: primalStatus,
          hosts: hostStatuses,
        });
      });
    },
    [primalEnabled, primalUrlKey]
  );

  useForegroundFocusEffect(
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

  return { primal, primalHosts, relay, isRefreshing, refresh };
}
