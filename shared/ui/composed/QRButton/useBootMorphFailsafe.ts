import { useEffect } from 'react';
import { withTiming, type SharedValue } from 'react-native-reanimated';

import { initLog } from '@/shared/lib/logger';

/**
 * How long to wait for the boot-morph splash→button visual handoff before
 * revealing the QR button regardless. The morph is an enhancement, not a gate.
 */
const BOOT_MORPH_FAILSAFE_MS = 1500;

/**
 * Fail-safe reveal for the QR button. The boot-morph anchor poll can race or
 * time out, leaving `morphCompleted` false so the button never fades in. After
 * `BOOT_MORPH_FAILSAFE_MS` we reveal it anyway. If the morph completes first,
 * the cleanup cancels this and the caller's morph effect does the reveal.
 *
 * Shared by QRButton.ios and QRButton.android so the two platform files can't
 * drift.
 */
export function useBootMorphFailsafe(
  morphCompleted: boolean,
  visibility: SharedValue<number>
): void {
  useEffect(() => {
    if (morphCompleted) return;
    const t = setTimeout(() => {
      initLog('QRButton', 'boot-morph failsafe reveal — morph did not complete in time');
      visibility.set(withTiming(1, { duration: 180 }));
    }, BOOT_MORPH_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, [morphCompleted, visibility]);
}
