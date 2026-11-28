import { useState, useSyncExternalStore } from 'react';

import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';

/** The scroll content's height, held outside React so a change re-renders only the overlay. */
type ContentHeightStore = {
  get: () => number;
  set: (height: number) => void;
  subscribe: (listener: () => void) => () => void;
};

function createContentHeightStore(): ContentHeightStore {
  let height = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => height,
    set: (next) => {
      if (next === height) return;
      height = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The home's content height for its gradient overlay. The scroller reports a
 * new height on every async arrival (balances, history, the map card); held
 * in React state that re-rendered the whole wallet home each time.
 */
export function useContentHeightStore(): {
  store: ContentHeightStore;
  onContentSizeChange: (width: number, height: number) => void;
} {
  const [store] = useState(createContentHeightStore);
  return { store, onContentSizeChange: (_width, height) => store.set(height) };
}

export function WalletGradientOverlay({ store }: { store: ContentHeightStore }) {
  const contentHeight = useSyncExternalStore(store.subscribe, store.get, store.get);
  return <ScrollableGradientOverlay contentHeight={contentHeight} />;
}
