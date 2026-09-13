import { facade } from 'nostr';
import { createFacadeFeedClient } from '@/features/feed/data/facadeFeedClient';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { emptyFeedParseResult, type FeedClient } from '@/features/feed/data/feedClient';

jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({ buildNostrDataLayer: jest.fn() }));
jest.mock('@/features/feed/data/feedCache', () => ({
  feedPageKey: (spec: string, viewer: string) => `${spec}:${viewer}`,
}));
jest.mock('@/shared/stores/runtime/debugTierStore', () => ({ recordDebugTiers: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({ feedLog: { info: jest.fn(), warn: jest.fn() } }));

const spec = JSON.stringify({ kind: 'notes', id: 'for-you' });
const fallback: Omit<FeedClient, 'getThread'> = {
  getFeed: jest.fn(async () => emptyFeedParseResult()),
  getUserFeed: jest.fn(async () => emptyFeedParseResult()),
  getPostsByPubkeys: jest.fn(async () => emptyFeedParseResult()),
  getNotifications: jest.fn(),
  enrich: jest.fn(async () => ({})),
  dispose: jest.fn(),
};

it('reuses a pager across pages, resets on page zero/refresh and disposes', async () => {
  const pager: facade.FeedPager = {
    nextPage: jest.fn(async () => ({
      pages: [],
      cursor: null,
      hasMore: true,
      retryAfterMs: 1_000,
      sources: [],
      showingRecent: false,
    })),
    dispose: jest.fn(),
  };
  const layer = facade.createNostrDataLayer({ tiers: [] });
  jest.spyOn(layer, 'createFeedPager').mockReturnValue(pager);
  jest.mocked(buildNostrDataLayer).mockReturnValue(layer);
  const client = createFacadeFeedClient(fallback);
  expect(await client.getFeed({ spec })).toMatchObject({ hasMore: true, retryAfterMs: 1_000 });
  await client.getFeed({ spec, loadMore: true });
  expect(layer.createFeedPager).toHaveBeenCalledTimes(1);
  await client.getFeed({ spec, refresh: true });
  expect(layer.createFeedPager).toHaveBeenCalledTimes(2);
  expect(pager.dispose).toHaveBeenCalledTimes(1);
  client.dispose?.();
  expect(pager.dispose).toHaveBeenCalledTimes(2);
});

it('starts fresh after a data-layer/profile replacement and seeds warm-page identities', async () => {
  const first = facade.createNostrDataLayer({ tiers: [] });
  const second = facade.createNostrDataLayer({ tiers: [] });
  const make = jest.spyOn(second, 'createFeedPager');
  jest.mocked(buildNostrDataLayer).mockReturnValueOnce(first).mockReturnValue(second);
  const client = createFacadeFeedClient(fallback);
  await client.getFeed({ spec });
  await client.getFeed({ spec, loadMore: true, seen: ['already-rendered'] });
  expect(make).toHaveBeenCalledWith(expect.objectContaining({ seen: ['already-rendered'] }));
  client.dispose?.();
});
