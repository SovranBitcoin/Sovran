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

  // Re-runs on gate/phase ticks are harmless no-ops: an unchanged strike map
  // diffs against itself, so no transition can fire twice.
  useEffect(() => {
    const prev = prevStrikeRef.current;
    prevStrikeRef.current = strikeMap;

    // Only ONE success per batch can claim the immediate-start slot — the
    // reducer queues the rest, whose haptic must therefore fire now (the
    // dispatch's state isn't visible until the next render).
    let idleSlotAvailable = !gated && celebration.phase === 'idle';

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
      const startsImmediately = !reducedMotion && idleSlotAvailable;
      idleSlotAvailable = false;

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
  }, [celebration.phase, gated, reducedMotion, strikeMap]);

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
    // Token the dispatch with the phase this timer was scheduled for: the
    // reducer drops it if a skip/gate flip won the race.
    const scheduledPhase = celebration.phase;
    const timer = setTimeout(() => {
      dispatch({ type: 'phase-complete', phase: scheduledPhase, now: Date.now() });
    }, delay);
    return () => clearTimeout(timer);
  }, [abbreviated, celebration.phase]);

  const skip = useCallback(() => {
    dispatch({ type: 'skip', now: Date.now() });
  }, []);

  return { celebration, skip };
}
