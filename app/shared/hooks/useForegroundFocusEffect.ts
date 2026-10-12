import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

const inForeground = () => AppState.currentState !== 'background';

/**
 * `useFocusEffect` for something the system tears down while the app is in
 * the background: an NFC session, a subscription, a probe, a countdown.
 *
 * A focus effect alone runs when the screen gains focus and never again while
 * it stays focused, so a screen left open across a trip to the background
 * comes back showing "armed" or "connected" over a resource that is gone. This
 * runs the effect while the screen is focused and the app is in the
 * foreground, cleans it up when either stops being true, and runs it again
 * when both are true again.
 *
 * `inactive` (the app switcher, a system sheet over the app) counts as the
 * foreground: tearing down and re-arming for a glance at Control Center would
 * be worse than leaving it. Pass a stable callback, as with `useFocusEffect`.
 */
export function useForegroundFocusEffect(effect: () => void | (() => void)): void {
  const [foreground, setForeground] = useState(inForeground);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => setForeground(inForeground()));
    return () => subscription.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!foreground) return undefined;
      return effect();
    }, [foreground, effect])
  );
}
