/**
 * Per-mint review rows + aggregate for the reviews screen and the mint-detail
 * read. In-memory only: the row list is "junk to store forever" (the durable
 * aggregate lives in `mintMetadataStore`), but within a session a re-opened
 * reviews screen must paint at 0ms and revalidate behind the rows rather than
 * blank to skeletons (hunch rule ui/read-states).
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { MintReviewsResponse } from '@/shared/lib/apiClient';
import { normalizeMintUrlKey } from '@/shared/lib/url';

export const mintReviewsCache = createQueryCacheStore<MintReviewsResponse>({
  name: 'mint-reviews-cache',
  logKey: 'mint_reviews_cache',
  staleTtlMs: 60 * 60 * 1000,
  maxEntries: 20,
  persist: false,
});

export function mintReviewsKey(mintUrl: string): string {
  return `reviews:${normalizeMintUrlKey(mintUrl)}`;
}
