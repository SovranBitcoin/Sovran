import { useEffect, useState } from 'react';

import { initLog } from '@/shared/lib/logger';
import { useBootMorphCompleted, useBootSplashHandoff } from '@/shared/lib/qrButtonAnchor';

/**
 * How long to wait for the boot-morph splash→button visual handoff before
 * revealing the QR button regardless. The morph is an enhancement, not a gate.
 */
const BOOT_MORPH_FAILSAFE_MS = 1500;
const REVEAL_MS = 180;

const HIDDEN_STYLE = {
  opacity: 0,
  transitionProperty: ['opacity'],
  transitionDuration: `${REVEAL_MS}ms`,
};
const REVEALED_STYLE = {
  opacity: 1,
  transitionProperty: ['opacity'],
  transitionDuration: `${REVEAL_MS}ms`,
};

/**
 * Owns the QR button's boot-morph reveal — shared by QRButton.ios and
 * QRButton.android so the platform files can't drift.
 *
 * The button fades in the moment the splash→button handoff starts (the morph
 * tween's first frame), or after the failsafe timeout (the anchor poll can
 * race or time out). Revealing at handoff — not at morph COMPLETION — is
 * deliberate: the overlay's geometry interpolates from a full-screen square
 * down to the button's own rect, so the opaque overlay covers the button for
 * the entire tween and the early reveal is invisible. By the time the overlay
 * docks, the button underneath is already fully opaque, which makes the final
 * swap seamless no matter how late the gate's JS completion timer fires on a
 * congested boot thread (it used to lag the UI-thread tween by 0.3–1.3s,
 * leaving a dead-looking look-alike parked on top of a hidden button).
 *
 * The fade is a declarative Reanimated CSS transition (the idiom the
 * boot-morph overlay in app/_layout.tsx uses): opacity is a committed React
 * prop, so every Fabric commit re-asserts it. A dropped UI-thread tick can at
 * worst skip the animation — it can never strand the button at a stale
 * mid-fade opacity, which is what the previous withTiming + static-settle
 * version did when the settle commit no-op'd against a JS-side style that
 * already claimed opacity 1. A profile switch resets both the handoff and the
 * morph flags, which hides the button again so the next reveal can fade in.
 */
export function useQRButtonReveal() {
  const handoff = useBootSplashHandoff();
  const morphCompleted = useBootMorphCompleted();
  const [failsafeRevealed, setFailsafeRevealed] = useState(false);

  useEffect(() => {
    if (handoff || morphCompleted) return;
    // Morph pending (boot) or reset (profile switch): hide and arm the
    // failsafe reveal.
    setFailsafeRevealed(false);
    const timer = setTimeout(() => {
      initLog('QRButton', 'boot-morph failsafe reveal — morph did not complete in time');
      setFailsafeRevealed(true);
    }, BOOT_MORPH_FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, [handoff, morphCompleted]);

  const revealed = handoff || morphCompleted || failsafeRevealed;

  return revealed ? REVEALED_STYLE : HIDDEN_STYLE;
}
