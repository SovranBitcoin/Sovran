/**
 * [DEBUG-inv] Dev-only reveal probe for the shared-value fade-in idiom
 * (`opacity: useSharedValue(0)` driven to 1 by `withTiming` in an effect) —
 * the pattern behind the intermittent "element present but invisible" reports
 * (profile pfp, top-followers grid, feed cards; the wallet QR button has since
 * moved to a declarative CSS-transition reveal and no longer needs probing).
 *
 * After `deadlineMs` it reads the shared value back:
 *   - value still < target  → `visual.fadeprobe.stuck`  (WARN) — the animation
 *     update never flushed on the UI thread (reanimated 4.3.x race class).
 *   - value at target       → `visual.fadeprobe.revealed` (DEBUG) — JS/UI state
 *     is correct; if the element is STILL blank on screen the failure is a
 *     paint-level one (needs a screenshot to catch, logs will look green).
 *
 * Remove alongside the diagnosis: grep `fadeprobe` / `DEBUG-inv`.
 */

import { useEffect } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { log } from '@/shared/lib/logger';

// [DEBUG-inv] build-liveness marker: proves which reanimated the RUNNING
// binary carries (a stale install reports the old version here). One line per
// session, on first probe-module load.
if (__DEV__) {
  log.info('visual.fadeprobe.armed', {
    reanimated: (require('react-native-reanimated/package.json') as { version: string }).version,
  });
}

export function useFadeRevealProbe(
  tag: string,
  value: SharedValue<number>,
  {
    deadlineMs = 1500,
    target = 1,
    enabled = true,
    onResult,
  }: {
    /** How long after arming before the value is read back. Set to the
     *  animation's delay + duration + a generous grace. */
    deadlineMs?: number;
    target?: number;
    /** Arm only when the condition that starts the animation is true —
     *  probing an intentionally-hidden element is a false positive. */
    enabled?: boolean;
    /** Stress-screen hook: receive the verdict without log spam. */
    onResult?: (stuck: boolean, value: number) => void;
  } = {}
): void {
  useEffect(() => {
    if (!__DEV__ || !enabled) return;
    const timer = setTimeout(() => {
      const v = value.get();
      const stuck = v < target - 0.01;
      if (onResult) {
        onResult(stuck, v);
      } else if (stuck) {
        log.warn('visual.fadeprobe.stuck', { tag, value: v, target, deadlineMs });
      } else {
        log.debug('visual.fadeprobe.revealed', { tag, value: v });
      }
    }, deadlineMs);
    return () => clearTimeout(timer);
    // `tag` is identity here; a re-armed probe should re-run only when the
    // arming condition or timing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, deadlineMs, target, enabled]);
}
