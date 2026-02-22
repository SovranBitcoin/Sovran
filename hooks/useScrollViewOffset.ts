import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

/**
 * Provides scroll position tracking for list/scroll components.
 * Use with LegendList/ScrollView onScroll for scroll-aware close animations.
 */
export function useScrollViewOffset() {
  const scrollOffsetY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffsetY.value = event.contentOffset.y;
    },
  });

  return { scrollOffsetY, scrollHandler };
}
