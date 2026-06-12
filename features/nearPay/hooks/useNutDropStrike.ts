import { useEffect, useRef, useState } from 'react';

import {
  deriveStrikeMap,
  type StrikeQueueEntry,
  type StrikeState,
} from '@/features/nearPay/lib/nutDropStrikeState';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

const LIVE_STATUSES = new Set(['pending', 'redeeming']);

/**
 * Maps the Nut Drop redeem queue to per-peer lightning-strike states for the
 * NearPay radar. Re-derives on queue changes plus one timer for the nearest
 * phase deadline (min-visible release, max cap, linger removal) — timers gate
 * component mount/unmount only, never per-frame animation (that runs on the
 * UI thread inside LightningStrike).
 *
 * Entries that were already terminal at mount never animate; entries already
 * mid-redemption at mount get the 'ambient' entrance (no strike-in).
 */
export function useNutDropStrike(): ReadonlyMap<string, StrikeState> {
  const byTokenHash = useNutDropRedeemQueueStore((state) => state.byTokenHash);
  const [map, setMap] = useState<ReadonlyMap<string, StrikeState>>(() => new Map());
  const prevRef = useRef<ReadonlyMap<string, StrikeState>>(new Map());
  const baselineRef = useRef<{ terminal: Set<string>; live: Set<string> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by the deadline timer to force a re-derive with a fresh `now`.
  const [tick, setTick] = useState(0);

  if (baselineRef.current === null) {
    const terminal = new Set<string>();
    const live = new Set<string>();
    for (const [hash, entry] of Object.entries(byTokenHash)) {
      if (LIVE_STATUSES.has(entry.status)) live.add(hash);
      else terminal.add(hash);
    }
    baselineRef.current = { terminal, live };
  }

  useEffect(() => {
    const baseline = baselineRef.current;
    if (!baseline) return;

    const { map: nextMap, nextDeadline } = deriveStrikeMap({
      entries: byTokenHash as Record<string, StrikeQueueEntry>,
      prev: prevRef.current,
      baselineTerminalHashes: baseline.terminal,
      baselineLiveHashes: baseline.live,
      now: Date.now(),
    });
    prevRef.current = nextMap;
    setMap((current) => (strikeMapsEqual(current, nextMap) ? current : nextMap));

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current =
      nextDeadline === null
        ? null
        : setTimeout(() => setTick((value) => value + 1), Math.max(16, nextDeadline - Date.now()));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [byTokenHash, tick]);

  return map;
}

function strikeMapsEqual(
  a: ReadonlyMap<string, StrikeState>,
  b: ReadonlyMap<string, StrikeState>
): boolean {
  if (a.size !== b.size) return false;
  for (const [peerID, state] of a) {
    const other = b.get(peerID);
    if (!other || other.status !== state.status || other.entrance !== state.entrance) {
      return false;
    }
  }
  return true;
}
