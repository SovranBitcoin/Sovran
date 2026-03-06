import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

/**
 * Scroll position tracking via Reanimated shared value.
 * Stays on the UI thread without JS re-renders during scroll.
 */
export function useScrollViewOffset() {
  const scrollOffsetY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffsetY.set(event.contentOffset.y);
    },
  });

  return { scrollOffsetY, scrollHandler };
}
