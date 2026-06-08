import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Defer a screen's heavy content until just after its first commit.
 *
 * Native-stack modals gate their present/slide animation on the new screen's
 * first rendered frame. Rendering the whole subtree synchronously on mount
 * therefore stretches the tap → present delay — badly under Low Power Mode,
 * where the JS thread is throttled. By returning `false` on the first commit
 * and flipping to `true` after interactions, callers can render a cheap frame
 * (themed background only) so the present starts immediately, then mount the
 * real content while the modal slides in.
 *
 * In native-stack the opening transition isn't a JS InteractionManager handle,
 * so `runAfterInteractions` fires on the next tick rather than after the slide
 * completes — content fills in during the animation, not after it.
 *
 * @param enabled when false the hook is a no-op and returns `true` immediately
 *   (use for screens that must render synchronously, e.g. auto-focus inputs).
 */
export function useDeferredMount(enabled = true): boolean {
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, [enabled]);

  return ready;
}
