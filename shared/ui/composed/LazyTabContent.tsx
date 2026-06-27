import React, { useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';

import { initLog } from '@/shared/lib/logger';

interface LazyTabContentProps {
  /** The expensive subtree to mount only after the tab has been focused at least once. */
  children: React.ReactNode;
  /** What to render before first focus. Default: nothing — keeps the tab frame cheap. */
  fallback?: React.ReactNode;
  /** For init-timeline visibility: log the first focus moment. */
  tag?: string;
}

/**
 * Mounts `children` only after the tab has been focused at least once.
 *
 * Why this exists: native iOS tabs (`expo-router/unstable-native-tabs` ⇒
 * `react-native-screens` ⇒ UITabBarController) eagerly create *every* tab's
 * content view on first render — that's how UITabBarController works, and
 * the only built-in deferral is `react-freeze`'s render-pause once the tab
 * loses focus. The first render still happens for every tab on cold boot,
 * which spins up wallpapers, scroll overlays, and any data fetches the tab
 * does in `useEffect` on mount.
 *
 * For non-wallet tabs (Feed / Contacts / Explore), the user almost never
 * needs them mid-boot. Wrapping the tab's body in `<LazyTabContent>` keeps
 * the tab screen frame mounted (so navigation works) but defers the heavy
 * subtree until the user actually swipes / taps over.
 *
 * Once the tab is focused, it stays mounted for the rest of the session —
 * no re-mount cost on subsequent tab switches.
 */
export function LazyTabContent({
  children,
  fallback = null,
  tag,
}: LazyTabContentProps): React.ReactElement | null {
  const isFocused = useIsFocused();
  const [hasBeenFocused, setHasBeenFocused] = useState(isFocused);

  useEffect(() => {
    if (!isFocused || hasBeenFocused) return;
    setHasBeenFocused(true);
    if (tag) initLog('LazyTab', `${tag} first focus — mounting`);
  }, [isFocused, hasBeenFocused, tag]);

  if (!hasBeenFocused) return <>{fallback}</>;
  return <>{children}</>;
}
