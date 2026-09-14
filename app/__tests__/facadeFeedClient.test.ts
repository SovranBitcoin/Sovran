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

describe('skimmable cap vs Primal-served For You', () => {
  const longNote = (id: string) => ({
    type: 'note' as const,
    event: {
      id,
      pubkey: 'b'.repeat(64),
      kind: 1,
      created_at: 1_700_000_000,
      tags: [] as string[][],
      content: 'x'.repeat(400),
    },
  });
  const pageFrom = (tier: 'nagg' | 'primal', id: string): facade.ResolvedFeedPage => ({
    tier,
    items: [longNote(id)],
    stats: {},
    profiles: {},
    quoted: {},
    cursor: null,
    hasMore: false,
    missingIds: [],
  });
  const clientWith = (pages: facade.ResolvedFeedPage[]) => {
    const pager: facade.FeedPager = {
      nextPage: jest.fn(async () => ({
        pages,
        cursor: null,
        hasMore: false,
        sources: pages.map((p) => p.tier),
        showingRecent: false,
      })),
      dispose: jest.fn(),
    };
    const layer = facade.createNostrDataLayer({ tiers: [] });
    jest.spyOn(layer, 'createFeedPager').mockReturnValue(pager);
    jest.mocked(buildNostrDataLayer).mockReturnValue(layer);
    return createFacadeFeedClient(fallback);
  };

  it('renders Primal trending uncapped (long notes dominate it) but keeps the cap elsewhere', async () => {
    const primalForYou = await clientWith([pageFrom('primal', 'p'.repeat(64))]).getFeed({ spec });
    expect(primalForYou.orderedFeedItems.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual(
      ['p'.repeat(64)]
    );

    const naggForYou = await clientWith([pageFrom('nagg', 'n'.repeat(64))]).getFeed({ spec });
    expect(naggForYou.orderedFeedItems).toEqual([]);

    const followingSpec = JSON.stringify({ kind: 'notes', id: 'following-recent' });
    const primalFollowing = await clientWith([pageFrom('primal', 'f'.repeat(64))]).getFeed({
      spec: followingSpec,
      userPubkey: 'a'.repeat(64),
    });
    expect(primalFollowing.orderedFeedItems).toEqual([]);
  });
});

describe('read status (SYSTEM.md F06): empty vs unavailable vs disabled', () => {
  it('marks tier exhaustion as unavailable with the attempt trail, not as an empty page', async () => {
    // A layer with no tiers exhausts every read.
    const layer = facade.createNostrDataLayer({ tiers: [] });
    jest.mocked(buildNostrDataLayer).mockReturnValue(layer);
    const client = createFacadeFeedClient(fallback);

    const userFeed = await client.getUserFeed({ pubkey: 'a'.repeat(64), readId: 'r1-profileFeed' });
    expect(userFeed.orderedFeedItems).toEqual([]);
    expect(userFeed.read).toMatchObject({
      status: 'unavailable',
      degraded: true,
      readId: 'r1-profileFeed',
    });

    const posts = await client.getPostsByPubkeys({ pubkeys: ['b'.repeat(64)] });
    expect(posts.read?.status).toBe('unavailable');

    const thread = await client.getThread({ eventId: 'c'.repeat(64) });
    expect(thread.tier).toBeNull();
    expect(thread.read?.status).toBe('unavailable');

    const notifications = await client.getNotifications({
      viewerPubkey: 'v'.repeat(64),
      tab: 'ALL',
    });
    expect(notifications.notifications).toEqual([]);
    expect(notifications.read?.status).toBe('unavailable');
  });

  it('marks "no tiers enabled" as disabled and a healthy empty answer as ok', async () => {
    jest.mocked(buildNostrDataLayer).mockReturnValue(null);
    const client = createFacadeFeedClient(fallback);
    const thread = await client.getThread({ eventId: 'c'.repeat(64) });
    expect(thread.read?.status).toBe('disabled');
    const notifications = await client.getNotifications({
      viewerPubkey: 'v'.repeat(64),
      tab: 'ALL',
    });
    expect(notifications.read?.status).toBe('disabled');
    // Untouched results carry no read meta: absent means ok.
    expect(emptyFeedParseResult().read).toBeUndefined();
  });
});
