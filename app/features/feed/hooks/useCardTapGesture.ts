/**
 * A card body opens its thread; nested controls own their entire touch.
 *
 * Two signals decide whether a recognised tap landed on the body:
 * - `probe` goes on the card root as `onStartShouldSetResponder`. The RN
 *   responder system only asks an ancestor after every descendant declined,
 *   so the probe firing means no nested Pressable or pressable Text claimed
 *   this touch — no per-control wiring needed.
 * - `suppress` is an explicit latch for nested controls. A disabled Pressable
 *   (a like still publishing) never claims the responder, so action bars
 *   latch it on touch start as well as press-in.
 *
 * `begin` (the root's responder capture) resets both before descendants see a
 * new touch. Suppression is never cleared on press-out, since recognition can
 * arrive later. Recognition also comes over the gesture-handler channel, which
 * can outrun the RN touch events for the same touch, so the decision waits one
 * macrotask for them to land. Keeping ref access inside the hook also
 * preserves PostCard compilation.
 */

import { useCallback, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

type CardTapGesture = {
  /** Attach to the card's `<GestureDetector>`. */
  gesture: ReturnType<typeof Gesture.Tap>;
  /** Wire to a nested control's `onPressIn` / touch start — swallows this touch's card tap. */
  suppress: () => void;
  /** Root `onStartShouldSetResponderCapture`: reset before descendants receive a new touch. */
  begin: () => false;
  /** Root `onStartShouldSetResponder`: reached only when no descendant claimed the touch. */
  probe: () => false;
  /** The suppression-aware tap handler, for plain `<Pressable onPress>` areas. */
  handleTap: () => void;
};

export function useCardTapGesture(onTap: () => void): CardTapGesture {
  const suppressedRef = useRef(false);
  const bodyTouchRef = useRef(false);

  const begin = useCallback(() => {
    suppressedRef.current = false;
    bodyTouchRef.current = false;
    return false as const;
  }, []);

  const probe = useCallback(() => {
    bodyTouchRef.current = true;
    return false as const;
  }, []);

  const suppress = useCallback(() => {
    suppressedRef.current = true;
  }, []);

  const handleTap = useCallback(() => {
    if (suppressedRef.current) return;
    onTap();
  }, [onTap]);

  const handleRecognizedTap = useCallback(() => {
    setTimeout(() => {
      // Consume the body-touch mark: a later recognition with no fresh RN
      // touch (tapping a flinging list to stop it) must not reuse it.
      const bodyTouch = bodyTouchRef.current;
      bodyTouchRef.current = false;
      if (bodyTouch && !suppressedRef.current) onTap();
    }, 0);
  }, [onTap]);

  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) handleRecognizedTap();
        }),
    [handleRecognizedTap]
  );

  return { gesture, suppress, begin, probe, handleTap };
}
