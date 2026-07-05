import { useCallback, useEffect, useState } from 'react';
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { initLog } from '@/shared/lib/logger';
import { useFadeRevealProbe } from '@/shared/lib/debug/fadeRevealProbe';
import { useBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';

/**
 * How long to wait for the boot-morph splash→button visual handoff before
 * revealing the QR button regardless. The morph is an enhancement, not a gate.
 */
const BOOT_MORPH_FAILSAFE_MS = 1500;
const REVEAL_MS = 180;
/** Grace past the reveal for the withTiming completion callback before
 *  settling anyway (the callback can be lost mid-churn). */
const SETTLE_FAILSAFE_MS = 600;

const SETTLED_STYLE = { opacity: 1 } as const;

/**
 * Owns the QR button's boot-morph reveal — shared by QRButton.ios and
 * QRButton.android so the platform files can't drift (absorbs the old
 * useBootMorphFailsafe).
 *
 * The button fades in when the splash→button morph completes, or after the
 * failsafe timeout (the anchor poll can race or time out). Once revealed,
 * opacity is handed back to React as a static style: a Fabric re-render
 * commit can rebuild the view's props from the JS-side style and silently
 * drop the UI-thread-applied opacity — the invisible-QR-button case, the
 * same clobber as the profile avatar. A plain style can't be clobbered.
 * A profile switch resets the morph, which un-settles back to the animated
 * style so the next reveal can fade in again.
 */
// Inferred return type: the reanimated style handle before settle, the plain
// static style after — both accepted by Animated.View's style prop.
export function useQRButtonReveal() {
  const morphCompleted = useBootMorphCompleted();
  const visibility = useSharedValue(morphCompleted ? 1 : 0);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: visibility.get() }));
  const [revealSettled, setRevealSettled] = useState(morphCompleted);
  const settleReveal = useCallback(() => setRevealSettled(true), []);

  useEffect(() => {
    if (morphCompleted) {
      visibility.set(
        withTiming(1, { duration: REVEAL_MS }, (finished) => {
          if (finished) runOnJS(settleReveal)();
        })
      );
      const settleTimer = setTimeout(settleReveal, REVEAL_MS + SETTLE_FAILSAFE_MS);
      return () => clearTimeout(settleTimer);
    }

    // Morph pending (boot) or reset (profile switch): hide, back on the
    // animated style, and arm the failsafe reveal.
    setRevealSettled(false);
    visibility.set(withTiming(0, { duration: REVEAL_MS }));
    const revealTimer = setTimeout(() => {
      initLog('QRButton', 'boot-morph failsafe reveal — morph did not complete in time');
      visibility.set(
        withTiming(1, { duration: REVEAL_MS }, (finished) => {
          if (finished) runOnJS(settleReveal)();
        })
      );
    }, BOOT_MORPH_FAILSAFE_MS);
    // Settles even if the failsafe reveal's animation itself never flushes —
    // the static style is the rescue of last resort.
    const settleTimer = setTimeout(
      settleReveal,
      BOOT_MORPH_FAILSAFE_MS + REVEAL_MS + SETTLE_FAILSAFE_MS
    );
    return () => {
      clearTimeout(revealTimer);
      clearTimeout(settleTimer);
    };
  }, [morphCompleted, visibility, settleReveal]);

  // [DEBUG-inv] deadline sits past the boot-morph failsafe + fade, so a stuck
  // report means both the morph rendezvous and the failsafe reveal failed to
  // flush the shared value — the case the static-style settle now papers over
  // visually, but still worth catching.
  useFadeRevealProbe('wallet.qrButton', visibility, { deadlineMs: 2600 });

  return revealSettled ? SETTLED_STYLE : animatedStyle;
}
