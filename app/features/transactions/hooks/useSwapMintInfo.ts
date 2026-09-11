import { useEffect, useMemo } from 'react';
import { useManager } from '@cashu/coco-react';
import { useShallow } from 'zustand/shallow';
import { getCachedMintInfo, useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { normalizeMintUrlKey } from '@/shared/lib/url';

type MintInfoSummary = { name?: string; icon_url?: string } | null;
const MAX_CONCURRENT_MISSES = 3;

/** Read existing public identities on the first frame; revalidate through the shared cache. */
export function useSwapMintInfo(mintUrls: string[]): Record<string, MintInfoSummary> {
  const manager = useManager();
  const entries = useMintMetadataStore(
    useShallow((state) => mintUrls.map((url) => state.byMintUrl[normalizeMintUrlKey(url)]))
  );

  useEffect(() => {
    let cancelled = false;
    void refreshMintIdentities(manager, mintUrls, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [manager, mintUrls]);

  return useMemo(
    () =>
      Object.fromEntries(
        mintUrls.map((url, index) => {
          const entry = entries[index];
          return [url, entry ? { name: entry.displayName, icon_url: entry.iconUrl } : null];
        })
      ),
    [mintUrls, entries]
  );
}

async function refreshMintIdentities(
  manager: ReturnType<typeof useManager>,
  urls: string[],
  isCancelled: () => boolean
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (!isCancelled() && nextIndex < urls.length) {
      const url = urls[nextIndex++];
      // Writes belong to the host-scoped cache, so a late old-group response
      // cannot replace the new group's visible identity map. Failures retain
      // cached identity (or the screen's existing domain-name fallback).
      await getCachedMintInfo((mintUrl) => manager.mint.getMintInfo(mintUrl), url).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_MISSES, urls.length) }, worker));
}
