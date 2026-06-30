import { useEffect, useRef, useState } from 'react';

import {
  deriveStrikeMap,
  type StrikeQueueEntry,
  type StrikeState,
} from '@/features/nearPay/lib/nutDropStrikeState';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { paymentLog } from '@/shared/lib/logger';

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

    const previousMap = prevRef.current;
    const { map: nextMap, nextDeadline } = deriveStrikeMap({
      entries: byTokenHash as Record<string, StrikeQueueEntry>,
      prev: previousMap,
      baselineTerminalHashes: baseline.terminal,
      baselineLiveHashes: baseline.live,
      now: Date.now(),
    });
    for (const [peerID, state] of nextMap) {
      const previous = previousMap.get(peerID);
      if (
        previous?.status === state.status &&
        previous.entrance === state.entrance &&
        previous.redeemedAmount === state.redeemedAmount
      ) {
        continue;
      }
      paymentLog.info('near_pay.strike.state', {
        peerID,
        from: previous?.status ?? null,
        to: state.status,
        entrance: state.entrance,
        redeemedAmount: state.redeemedAmount ?? null,
        unit: state.unit ?? null,
      });
    }
    for (const [peerID, previous] of previousMap) {
      if (!nextMap.has(peerID)) {
        paymentLog.info('near_pay.strike.state', {
          peerID,
          from: previous.status,
          to: 'removed',
          entrance: previous.entrance,
        });
      }
    }
    prevRef.current = nextMap;

    // Retire surfaced redemptions: redeemed entries persist in the queue
    // store for 24h, so without this a later drop from the same sender
    // would recount them and the celebration would announce a session
    // total instead of the drop's amount. The lingering success state is
    // unaffected (the derive carries `prev` forward past the baseline).
    for (const state of nextMap.values()) {
      if (state.status !== 'success' || !state.redeemedHashes) continue;
      for (const hash of state.redeemedHashes) baseline.terminal.add(hash);
    }
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
    if (
      !other ||
      other.status !== state.status ||
      other.entrance !== state.entrance ||
      // A coalesced second redemption must propagate to the celebration's
      // amount reveal even though the status stays 'success'.
      other.redeemedAmount !== state.redeemedAmount
    ) {
      return false;
    }
  }
  return true;
}
