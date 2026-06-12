import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import {
  CELEBRATION_CENTERING_MS,
  CELEBRATION_HOLD_ABBREVIATED_MS,
  CELEBRATION_HOLD_MS,
  CELEBRATION_RETURN_MS,
} from '@/features/nearPay/components/NutDropCelebrationOverlay';
import {
  celebrationReducer,
  INITIAL_CELEBRATION_STATE,
  type CelebrationState,
} from '@/features/nearPay/lib/nutDropCelebration';
import type { StrikeState } from '@/features/nearPay/lib/nutDropStrikeState';
import { paymentLog } from '@/shared/lib/logger';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

/**
 * Bridges the per-peer strike map to the celebration reducer and owns the
 * beat clock (phase timeouts) plus the haptic channel.
 *
 * Trigger rule: only an OBSERVED 'active' → 'success' transition fires — the
 * strike baseline already guarantees entries terminal at mount never appear
 * active, so reopening the screen can never replay a celebration.
 *
 * Haptics are the never-fatiguing information channel and fire exactly once
 * per redeem success:
 * - an immediately-starting ceremony defers the success haptic to the
 *   impact frame (the 'held' flip — synchronized with the canvas bolts);
 * - gated / reduced-motion / queued / coalesced successes haptic right away
 *   (their visible mark is the node resolve + toast); ceremonies later
 *   replayed from the queue are decorative and do NOT haptic again.
 *
 * Reduce Motion: never dispatches into the reducer — no takeover, no node
 * suppression; the node's own strike resolve plays and the haptic + toast
 * carry the moment.
 */
export function useNutDropCelebration({
  strikeMap,
  gated,
}: {
  strikeMap: ReadonlyMap<string, StrikeState>;
  gated: boolean;
}): { celebration: CelebrationState; skip: () => void } {
  const reducedMotion = useReducedMotion();
  const [celebration, dispatch] = useReducer(celebrationReducer, INITIAL_CELEBRATION_STATE);
  const prevStrikeRef = useRef<ReadonlyMap<string, StrikeState>>(new Map());
  const pendingImpactHapticRef = useRef(false);
  // Mirrors the reducer inputs the strike effect needs without re-running it
  // on every reducer tick (a re-run would re-diff an unchanged strike map).
  const gateRef = useRef(gated);
  const phaseRef = useRef(celebration.phase);
  gateRef.current = gated;
  phaseRef.current = celebration.phase;

  useEffect(() => {
    const prev = prevStrikeRef.current;
    prevStrikeRef.current = strikeMap;

    for (const [peerID, state] of strikeMap) {
      const prevStatus = prev.get(peerID)?.status;

      if (state.status === 'active' && prevStatus === undefined && state.entrance === 'strike') {
        // Incoming-drop tick — a fresh crackle just started.
        void EnhancedHaptics.buttonHaptic();
        continue;
      }

      if (state.status !== 'success' || prevStatus !== 'active') continue;

      const amount = state.redeemedAmount ?? 0;
      const unit = state.unit ?? 'sat';
      const now = Date.now();
      const startsImmediately = !reducedMotion && !gateRef.current && phaseRef.current === 'idle';

      if (startsImmediately) {
        pendingImpactHapticRef.current = true;
      } else {
        void EnhancedHaptics.successHaptic();
      }
      paymentLog.info('near_pay.celebration.success_observed', {
        peerID,
        amount,
        unit,
        startsImmediately,
        reducedMotion,
      });
      if (reducedMotion) continue;
      dispatch({ type: 'strike-success', peerID, amount, unit, now });
    }
  }, [reducedMotion, strikeMap]);

  useEffect(() => {
    if (reducedMotion) return;
    dispatch({ type: 'gate-changed', gated, now: Date.now() });
  }, [gated, reducedMotion]);

  // Impact frame: the canvas bolts key on the same 'held' flip, so firing
  // here lands the haptic on the strike's first frame. A skip or gate
  // interrupt during the flight still owes the payment its one haptic — fire
  // on whatever phase ends the wait instead of dropping it.
  useEffect(() => {
    if (celebration.phase === 'centering') return;
    if (!pendingImpactHapticRef.current) return;
    pendingImpactHapticRef.current = false;
    void EnhancedHaptics.successHaptic();
  }, [celebration.phase]);

  // Beat clock — one timeout per phase; the overlay animates to match. Keyed
  // on phase + abbreviated only: a same-sender coalesce updates the amount
  // without restarting the hold timer.
  const abbreviated = celebration.current?.abbreviated ?? false;
  useEffect(() => {
    if (celebration.phase === 'idle') return;
    const holdMs = abbreviated ? CELEBRATION_HOLD_ABBREVIATED_MS : CELEBRATION_HOLD_MS;
    const delay =
      celebration.phase === 'centering'
        ? CELEBRATION_CENTERING_MS
        : celebration.phase === 'held'
          ? holdMs
          : CELEBRATION_RETURN_MS;
    const timer = setTimeout(() => {
      dispatch({ type: 'phase-complete', now: Date.now() });
    }, delay);
    return () => clearTimeout(timer);
  }, [abbreviated, celebration.phase]);

  const skip = useCallback(() => {
    dispatch({ type: 'skip', now: Date.now() });
  }, []);

  return { celebration, skip };
}
