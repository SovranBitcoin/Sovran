import type { MintReviewsResponse } from '@/shared/lib/apiClient';
import type { QueryCacheRunContext } from '@/shared/lib/cache/createQueryCacheStore';
import { fetchMintReviews } from '@/shared/lib/nostr/fetchMintReviews';
import { reviewAggregateOf } from '@/shared/lib/nostr/reviewAggregate';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';

/** Shared cache fetcher: first paint and later tiers write only while this run is current. */
export async function readMintReviews(
  mintUrl: string,
  ctx: QueryCacheRunContext<MintReviewsResponse>
): Promise<{ data: MintReviewsResponse }> {
  let latest: MintReviewsResponse | undefined;
  const paint = (data: MintReviewsResponse) => {
    latest = data;
    if (!ctx.partial(data)) return;
    const store = useMintMetadataStore.getState();
    const stored = store.getCached(mintUrl);
    const aggregate = reviewAggregateOf(data, stored?.reviewCount, stored?.averageScore);
    if (aggregate.authoritative) {
      store.setReviewsAggregate(mintUrl, aggregate.score, aggregate.reviewCount);
    }
  };
  const result = await fetchMintReviews({
    mintUrl,
    signal: ctx.signal,
    readId: ctx.readId,
    onUpdate: paint,
  });
  if (result.isErr()) throw result.error;
  // An update can arrive before the first-paint promise continuation runs.
  const data = latest ?? result.value;
  if (!latest) paint(data);
  return { data };
}
