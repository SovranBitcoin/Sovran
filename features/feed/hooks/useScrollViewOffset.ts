import { useEffect } from 'react';
import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { feedLog } from '@/shared/lib/logger';

/**
 * Scroll position tracking via Reanimated shared value.
 * Stays on the UI thread without JS re-renders during scroll.
 */
export function useScrollViewOffset() {
  useEffect(() => { feedLog.debug('feed.scroll.offset.init'); }, []);
  const scrollOffsetY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffsetY.set(event.contentOffset.y);
    },
  });

  return { scrollOffsetY, scrollHandler };
}
