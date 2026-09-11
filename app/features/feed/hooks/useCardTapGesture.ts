/**
 * A card body opens its thread; nested actions own their entire touch.
 * The ancestor responder-capture resets the latch before descendants receive
 * press-in. Press-out never clears it, since native recognition can arrive later.
 * Keeping ref access inside the hook also preserves PostCard compilation.
 */

import { useCallback, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

type CardTapGesture = {
  /** Attach to the card's `<GestureDetector>`. */
  gesture: ReturnType<typeof Gesture.Tap>;
  /** Wire to a nested pressable's `onPressIn` — swallows the next card tap. */
  suppress: () => void;
  /** Reset before descendants receive a new physical touch; never claims the responder. */
  begin: () => false;
  /** The suppression-aware tap handler, for plain `<Pressable onPress>` areas. */
  handleTap: () => void;
};

export function useCardTapGesture(onTap: () => void): CardTapGesture {
  const suppressedRef = useRef(false);
  const begin = useCallback(() => {
    suppressedRef.current = false;
    return false as const;
  }, []);

  const suppress = useCallback(() => {
    suppressedRef.current = true;
  }, []);

  // Press-out can precede the parent's recognition by an arbitrary JS delay.
  // Keep this touch suppressed until the next responder-capture begins.

  const handleTap = useCallback(() => {
    if (suppressedRef.current) return;
    onTap();
  }, [onTap]);

  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) handleTap();
        }),
    [handleTap]
  );

  return { gesture, suppress, begin, handleTap };
}
