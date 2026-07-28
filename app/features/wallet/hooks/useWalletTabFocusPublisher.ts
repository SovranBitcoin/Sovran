/**
 * Publishes the wallet tab's focus into the qrButtonAnchor module store so
 * the boot splash gate (which sits above the navigator and can't use
 * useIsFocused itself) can fast-forward the splash→QR morph overlay when the
 * user switches tabs mid-boot.
 *
 * Two publish paths on purpose:
 * - useIsFocused mirror: native tabs eagerly mount every tab screen, so on a
 *   slow boot the wallet can mount *unfocused* (user already sat on Feed) —
 *   useFocusEffect alone never fires for a screen that mounts blurred.
 * - useFocusEffect events: react-freeze can defer the isFocused=false
 *   re-render on a frozen tab; the navigation event still fires (the same
 *   lifecycle useAmbientNfcArm relies on). The two paths cover each other.
 */

import { useCallback, useEffect } from 'react';
import { useFocusEffect, useIsFocused } from 'expo-router';

import { setWalletTabFocused } from '@/shared/lib/qrButtonAnchor';

export function useWalletTabFocusPublisher(): void {
  const isFocused = useIsFocused();
  useEffect(() => {
    setWalletTabFocused(isFocused);
  }, [isFocused]);

  useFocusEffect(
    useCallback(() => {
      setWalletTabFocused(true);
      return () => setWalletTabFocused(false);
    }, [])
  );
}
