import { answered, failed, unsupported, type TierOutcome } from '../../tiers';
import type { FeedBundle, FeedPageRequest, FeedSpec, FeedTier } from '../feed';
import { demuxRelayFeed } from './demux';
import type { NostrFilter, RelayConnection } from './protocol';

// ---------------------------------------------------------------------------
// Raw-relay tier (tier 3, the floor)
//
// The honest-decentralisation source. Feature ceilings are accepted here, per
// the per-surface matrix: For-You is OUT OF REACH on relays, so it degrades to
// a recent feed; a spec that needs server-side context the floor can't provide
// returns `unsupported` (the engine has already exhausted the better tiers by
// the time we reach the floor, so unsupported there surfaces as an honest error).
// ---------------------------------------------------------------------------

export type RelayTierConfig = {
  connection: RelayConnection;
};

export function createRelayTier(config: RelayTierConfig): FeedTier {
  return {
    tier: 'relay',
    async feedPage(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>> {
      const filters = filtersForSpec(request.spec, {
        until: request.cursor?.createdAt,
        limit: request.limit,
      });
      if (!filters) return unsupported();

      const result = await config.connection.request(filters, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<FeedBundle>>(
        (events) => answered(demuxRelayFeed(events)),
        (error) => failed(error),
      );
    },
  };
}

function filtersForSpec(
  spec: FeedSpec,
  paging: { until?: number; limit?: number },
): NostrFilter[] | null {
  switch (spec.kind) {
    case 'for-you':
      // For-You can't be ranked on the floor — degrade to recent global notes.
      return [
        {
          kinds: [1],
          limit: paging.limit ?? 30,
          ...(paging.until ? { until: paging.until } : {}),
        },
      ];
    case 'following-popular':
      // Needs the viewer's follow list (kind 3) resolved first — handled once the
      // social-graph surface lands; until then, fall through.
      return null;
  }
}
