import type { NaggClient } from '../transport';
import { NaggFeedPageSchema, NaggThreadSchema } from '../schemas';
import { rankedFeedAppView, threadAppView } from '../recipes/appview-feed';
import { forYouRankedEventsInput, followingPopularRankedEventsInput } from '../recipes/feed';
import type { NaggFeedPage } from '../map/feed';
import { answered, failed, type TierOutcome } from '../tiers';
import {
  bundleFromFeedPage,
  type FeedBundle,
  type FeedPageRequest,
  type FeedSpec,
} from './feed';
import { bundleFromThread, type ThreadBundle, type ThreadRequest, type ThreadSource } from './thread';
import type { NostrTierStrategy } from './strategy';

// ---------------------------------------------------------------------------
// nagg tier (tier 1, gold)
//
// Our own app-view: fully bundled + server-ranked. The richest tier — it answers
// every read. This adapter reuses the existing ranked-feed recipe + canonical
// `NaggFeedPageSchema`, served over nagg's REST app-view via `client.rest`, and
// bridges the (already-ordered) response into the contract `FeedBundle`.
//
// Cross-tier fallback (nagg → Primal → relay) is the FACADE's job; within this
// tier we use the REST app-view as the primary transport. (The in-nagg
// appview→GraphQL fallback the app does today moves here in a follow-up, once
// the ranked GraphQL query is ported down from sovran-app.)
// ---------------------------------------------------------------------------

export type NaggTierConfig = {
  client: NaggClient;
};

export function createNaggTier(config: NaggTierConfig): NostrTierStrategy {
  const { client } = config;

  return {
    tier: 'nagg',
    async feedPage(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>> {
      const binding = rankedBindingForSpec(request);
      const result = await client.rest<typeof NaggFeedPageSchema>({
        path: binding.path,
        method: binding.method ?? 'POST',
        body: binding.body,
        responseSchema: NaggFeedPageSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<FeedBundle>>(
        (page) => answered(bundleFromFeedPage(page as NaggFeedPage)),
        (error) => failed(error),
      );
    },

    async thread(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>> {
      const binding = threadAppView({ id: request.noteId, limit: request.limit });
      const result = await client.rest<typeof NaggThreadSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggThreadSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<ThreadBundle>>(
        (thread) => answered(bundleFromThread(thread as ThreadSource)),
        (error) => failed(error),
      );
    },
  };
}

function rankedBindingForSpec(request: FeedPageRequest) {
  const until = request.cursor?.createdAt;
  const limit = request.limit;
  const input = rankedInputForSpec(request.spec, { until, limit });
  return rankedFeedAppView(input);
}

function rankedInputForSpec(
  spec: FeedSpec,
  paging: { until?: number; limit?: number },
) {
  switch (spec.kind) {
    case 'for-you':
      return forYouRankedEventsInput({
        viewerPubkey: spec.viewerPubkey,
        until: paging.until,
        limit: paging.limit,
      });
    case 'following-popular':
      return followingPopularRankedEventsInput({
        viewerPubkey: spec.viewerPubkey,
        until: paging.until,
        limit: paging.limit,
      });
  }
}
