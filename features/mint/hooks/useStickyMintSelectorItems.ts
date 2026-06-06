import { useEffect, useMemo, useRef } from 'react';
import type { MintListItem } from '@sovranbitcoin/colada';

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
  if (hasItems(liveItems)) return liveItems;
  if (hasItems(previousLiveItems)) return previousLiveItems;
  if (hasItems(entryItems)) return entryItems;
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
