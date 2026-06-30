import { useEffect, useMemo, useRef } from 'react';
import type { MintListItem } from 'wallet';

import { cashuLog } from '@/shared/lib/logger';

function hasItems(items: MintListItem[] | null | undefined): items is MintListItem[] {
  return Array.isArray(items) && items.length > 0;
}

export function resolveStickyMintSelectorItems({
  liveItems,
  entryItems,
  previousLiveItems,
}: {
  liveItems: MintListItem[] | null | undefined;
  entryItems: MintListItem[] | null | undefined;
  previousLiveItems: MintListItem[] | null | undefined;
}): MintListItem[] {
  const liveCount = Array.isArray(liveItems) ? liveItems.length : 0;
  const previousLiveCount = Array.isArray(previousLiveItems) ? previousLiveItems.length : 0;
  const entryCount = Array.isArray(entryItems) ? entryItems.length : 0;

  if (hasItems(liveItems)) {
    cashuLog.debug('mint.selector.sticky_items.result', {
      source: 'live',
      liveCount,
      previousLiveCount,
      entryCount,
    });
    return liveItems;
  }
  if (hasItems(previousLiveItems)) {
    cashuLog.debug('mint.selector.sticky_items.result', {
      source: 'previous-live',
      liveCount,
      previousLiveCount,
      entryCount,
    });
    return previousLiveItems;
  }
  if (hasItems(entryItems)) {
    cashuLog.debug('mint.selector.sticky_items.result', {
      source: 'entry',
      liveCount,
      previousLiveCount,
      entryCount,
    });
    return entryItems;
  }
  cashuLog.debug('mint.selector.sticky_items.result', {
    source: 'empty',
    liveCount,
    previousLiveCount,
    entryCount,
  });
  return [];
}

export function useStickyMintSelectorItems(
  liveItems: MintListItem[] | null | undefined,
  entryItems: MintListItem[] | null | undefined
): MintListItem[] {
  const previousLiveItemsRef = useRef<MintListItem[] | null>(null);

  useEffect(() => {
    if (hasItems(liveItems)) {
      previousLiveItemsRef.current = liveItems;
      cashuLog.debug('mint.selector.sticky_items.cache_live', {
        liveCount: liveItems.length,
      });
    }
  }, [liveItems]);

  return useMemo(
    () =>
      resolveStickyMintSelectorItems({
        liveItems,
        entryItems,
        previousLiveItems: previousLiveItemsRef.current,
      }),
    [entryItems, liveItems]
  );
}
