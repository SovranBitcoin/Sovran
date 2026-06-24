import { useEffect, useReducer, useRef } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import {
  CELEBRATION_AWAITING_TIMEOUT_MS,
  CELEBRATION_CENTERING_MS,
  CELEBRATION_EXIT_MS,
  CELEBRATION_HOLD_ABBREVIATED_MS,
  CELEBRATION_HOLD_MS,
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
 * Trigger rules (all from OBSERVED strike-map transitions — the strike
 * baseline guarantees entries terminal at mount never appear active, so
 * reopening the screen can never replay a celebration):
 * - fresh 'strike'-entrance active → the takeover starts (flight + gold
 *   crackle while the redeem runs);
 * - 'active' → 'success' → the impact (the amount is a per-cycle delta);
 * - 'active' → 'waiting' → full lightning beat with no amount reveal;
 * - 'active' → 'fading'/removed → quiet return flight, no impact.
 *
 * Haptics are the never-fatiguing information channel and fire exactly once
 * per redeem success:
 * - a success that will produce an impact on the playing ceremony defers
 *   its haptic to the 'held' flip (synchronized with the canvas bolts);
 * - gated / reduced-motion / queued / coalesced-into-held successes haptic
 *   right away (their visible mark is the node resolve + toast); ceremonies
 *   later replayed from the queue are decorative and do NOT haptic again.
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
  const celebrationDebugRef = useRef<{
    peerID: string | null;
    waiting: boolean;
    hasAmount: boolean;
  }>({ peerID: null, waiting: false, hasAmount: false });

  // Re-runs on gate/phase ticks are harmless no-ops: an unchanged strike map
  // diffs against itself, so no transition can fire twice.
  useEffect(() => {
    const prev = prevStrikeRef.current;
    prevStrikeRef.current = strikeMap;

    for (const [peerID, state] of strikeMap) {
      const prevStatus = prev.get(peerID)?.status;

      if (state.status === 'active' && prevStatus === undefined && state.entrance === 'strike') {
        // Incoming-drop tick — and the takeover begins while the redeem runs.
        void EnhancedHaptics.buttonHaptic();
        paymentLog.info('near_pay.celebration.drop_observed', { peerID, reducedMotion });
        if (reducedMotion) continue;
        dispatch({ type: 'strike-active', peerID, unit: 'sat', now: Date.now() });
        continue;
      }

      if (state.status === 'success' && prevStatus === 'active') {
        const amount = state.redeemedAmount ?? 0;
        const unit = state.unit ?? 'sat';
        // The success lands an impact on the PLAYING ceremony when this
        // sender is current and the payoff hasn't fired yet — sync the
        // haptic to that 'held' flip. Everything else haptics now.
        const impactsCurrent =
          !reducedMotion &&
          ((celebration.current?.peerID === peerID &&
            (celebration.phase === 'centering' || celebration.phase === 'awaiting')) ||
            (!gated && celebration.phase === 'idle'));
        if (impactsCurrent) {
          pendingImpactHapticRef.current = true;
        } else {
          void EnhancedHaptics.successHaptic();
        }
        paymentLog.info('near_pay.celebration.success_observed', {
          peerID,
          amount,
          unit,
          impactsCurrent,
          reducedMotion,
        });
        if (reducedMotion) continue;
        dispatch({ type: 'strike-success', peerID, amount, unit, now: Date.now() });
        continue;
      }

      if (state.status === 'waiting' && prevStatus === 'active') {
        void EnhancedHaptics.warningHaptic();
        paymentLog.info('near_pay.celebration.waiting_observed', {
          peerID,
          reducedMotion,
        });
        if (reducedMotion) continue;
        dispatch({ type: 'strike-waiting', peerID, now: Date.now() });
        continue;
      }

      if (prevStatus === 'active' && state.status === 'fading') {
        if (reducedMotion) continue;
        dispatch({ type: 'strike-failed', peerID, now: Date.now() });
      }
    }

    // Entries can leave the map without passing through 'fading' (pruned
    // mid-derive). A vanished active strike must still release the stage.
    for (const [peerID, state] of prev) {
      if (state.status !== 'active' || strikeMap.has(peerID) || reducedMotion) continue;
      dispatch({ type: 'strike-failed', peerID, now: Date.now() });
    }
  }, [celebration.current?.peerID, celebration.phase, gated, reducedMotion, strikeMap]);

  useEffect(() => {
    if (reducedMotion) return;
    dispatch({ type: 'gate-changed', gated, now: Date.now() });
  }, [gated, reducedMotion]);

  // Impact frame: the canvas bolts key on the same 'held' flip, so firing
  // here lands the haptic on the strike's first frame. A skip or gate
  // interrupt racing the impact still owes the payment its one haptic —
  // fire on whatever phase ends the wait. 'centering'/'awaiting' are the
  // only phases still waiting for the payoff.
  useEffect(() => {
    if (celebration.phase === 'centering' || celebration.phase === 'awaiting') return;
    if (!pendingImpactHapticRef.current) return;
    pendingImpactHapticRef.current = false;
    void EnhancedHaptics.successHaptic();
  }, [celebration.phase]);

  // Beat clock — one timeout per phase; the overlay animates to match.
  // 'awaiting' is event-driven (success/failure ends it) with a safety
  // timeout. Keyed on phase + abbreviated only: a same-sender coalesce
  // updates the amount without restarting the hold timer.
  const abbreviated = celebration.current?.abbreviated ?? false;
  celebrationDebugRef.current = {
    peerID: celebration.current?.peerID ?? null,
    waiting: celebration.current?.waiting ?? false,
    hasAmount: celebration.current?.amount !== null,
  };
  useEffect(() => {
    if (celebration.phase === 'idle') return;
    const holdMs = abbreviated ? CELEBRATION_HOLD_ABBREVIATED_MS : CELEBRATION_HOLD_MS;
    const delay =
      celebration.phase === 'centering'
        ? CELEBRATION_CENTERING_MS
        : celebration.phase === 'awaiting'
          ? CELEBRATION_AWAITING_TIMEOUT_MS
          : celebration.phase === 'held'
            ? holdMs
            : CELEBRATION_EXIT_MS;
    // Token the dispatch with the phase this timer was scheduled for: the
    // reducer drops it if a skip/gate/success flip won the race.
    const scheduledPhase = celebration.phase;
    const scheduledDebug = celebrationDebugRef.current;
    paymentLog.debug('near_pay.celebration.phase_scheduled', {
      phase: scheduledPhase,
      delayMs: delay,
      peerID: scheduledDebug.peerID,
      waiting: scheduledDebug.waiting,
      hasAmount: scheduledDebug.hasAmount,
      abbreviated,
    });
    const timer = setTimeout(() => {
      paymentLog.debug('near_pay.celebration.phase_complete', {
        phase: scheduledPhase,
        peerID: scheduledDebug.peerID,
      });
      dispatch({ type: 'phase-complete', phase: scheduledPhase, now: Date.now() });
    }, delay);
    return () => clearTimeout(timer);
  }, [abbreviated, celebration.phase]);

  const skip = () => {
    paymentLog.info('near_pay.celebration.skipped', {
      phase: celebration.phase,
      peerID: celebration.current?.peerID ?? null,
    });
    dispatch({ type: 'skip', now: Date.now() });
  };

  return { celebration, skip };
}
