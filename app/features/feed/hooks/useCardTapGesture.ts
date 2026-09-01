/**
 * @fileoverview Card-level tap-to-open-thread, suppressed while a nested
 * pressable is active.
 *
 * A feed card is one large tap target with smaller ones inside it — the avatar,
 * a quoted post, the action row, an image. Without suppression, pressing any of
 * those ALSO opens the thread, because the card's tap gesture still fires. The
 * nested control announces itself on press-in/press-out and the card ignores
 * taps in between.
 *
 * The suppression flag is a ref, and it lives HERE rather than inline in each
 * card: React Compiler refuses to compile any component that hands a
 * ref-reading closure to a function during render (which `Gesture.Tap().onEnd`
 * is), and a feed row is the last component in the app that can afford to
 * render unmemoized. Keeping the ref inside this hook costs the hook its own
 * (worthless) memoization and buys every card back its own.
 */

import { useCallback, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

type CardTapGesture = {
  /** Attach to the card's `<GestureDetector>`. */
  gesture: ReturnType<typeof Gesture.Tap>;
  /** Wire to a nested pressable's `onPressIn` — swallows the next card tap. */
  suppress: () => void;
  /** Wire to the same pressable's `onPressOut`. */
  release: () => void;
  /** The suppression-aware tap handler, for plain `<Pressable onPress>` areas. */
  handleTap: () => void;
};

export function useCardTapGesture(onTap: () => void): CardTapGesture {
  const suppressedRef = useRef(false);

  const suppress = useCallback(() => {
    suppressedRef.current = true;
  }, []);

  // Released on the next tick, not synchronously: press-out lands before the
  // card's tap gesture ends, so clearing it immediately would let the tap
  // through — the bug this whole protocol exists to prevent.
  const release = useCallback(() => {
    setTimeout(() => {
      suppressedRef.current = false;
    }, 0);
  }, []);

  const handleTap = useCallback(() => {
    if (suppressedRef.current) return;
    onTap();
  }, [onTap]);

  const gesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        'worklet';
        runOnJS(handleTap)();
      }),
    [handleTap]
  );

  return { gesture, suppress, release, handleTap };
}
