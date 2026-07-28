import { useEffect, useState } from 'react';

import { initLog } from '@/shared/lib/logger';
import { useBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';

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
 * The button fades in when the splash→button morph completes, or after the
 * failsafe timeout (the anchor poll can race or time out). The fade is a
 * declarative Reanimated CSS transition (the idiom the boot-morph overlay in
 * app/_layout.tsx uses): opacity is a committed React prop, so every Fabric
 * commit re-asserts it. A dropped UI-thread tick can at worst skip the
 * animation — it can never strand the button at a stale mid-fade opacity,
 * which is what the previous withTiming + static-settle version did when the
 * settle commit no-op'd against a JS-side style that already claimed
 * opacity 1. A profile switch resets the morph, which hides the button again
 * so the next reveal can fade in.
 */
export function useQRButtonReveal() {
  const morphCompleted = useBootMorphCompleted();
  const [failsafeRevealed, setFailsafeRevealed] = useState(false);

  useEffect(() => {
    if (morphCompleted) return;
    // Morph pending (boot) or reset (profile switch): hide and arm the
    // failsafe reveal.
    setFailsafeRevealed(false);
    const timer = setTimeout(() => {
      initLog('QRButton', 'boot-morph failsafe reveal — morph did not complete in time');
      setFailsafeRevealed(true);
    }, BOOT_MORPH_FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, [morphCompleted]);

  const revealed = morphCompleted || failsafeRevealed;

  return revealed ? REVEALED_STYLE : HIDDEN_STYLE;
}
