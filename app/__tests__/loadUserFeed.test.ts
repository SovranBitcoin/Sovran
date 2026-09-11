import { loadUserFeedImpl, type UserFeedLoadCtx } from '@/features/feed/lib/loadUserFeed';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import { emptyFeedParseResult, type FeedClient } from '@/features/feed/data/feedClient';
import type { FeedItem } from '@/features/feed/components/nostr/feedTypes';

jest.mock('@/features/feed/data/useFeedClient', () => ({ getFeedClient: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  feedLog: { info: jest.fn(), warn: jest.fn() },
  log: { error: jest.fn() },
}));
jest.mock('@/shared/stores/profile/nostrSocialStore', () => ({
  useNostrSocialStore: { getState: () => ({ deletedRepostOriginalIds: {} }) },
}));

const item: Extract<FeedItem, { type: 'note' }> = {
  type: 'note',
  timestamp: 200,
  event: {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 1,
    content: 'A real post',
    tags: [],
    created_at: 200,
  },
};

function setup() {
  let visibleItems: FeedItem[] = [];
  const page = { ...emptyFeedParseResult(), orderedFeedItems: [item], paginationUntil: 200 };
  const client: FeedClient = {
    getFeed: jest.fn(),
    getPostsByPubkeys: jest.fn(),
    getThread: jest.fn(),
    getNotifications: jest.fn(),
    getUserFeed: jest.fn().mockResolvedValue(page),
    enrich: jest.fn().mockResolvedValue({}),
    dispose: jest.fn(),
  };
  jest.mocked(getFeedClient).mockReturnValue(client);
  const ctx: UserFeedLoadCtx = {
    pubkey: item.event.pubkey,
    authorName: undefined,
    authorPicture: undefined,
    isOwnProfile: false,
    hasMoreRef: { current: true },
    paginationUntilRef: { current: 0 },
    paginationOffsetRef: { current: 0 },
    loadingMoreRef: { current: false },
    feedItemIdsRef: { current: new Set() },
    activeLoadMoreIdRef: { current: null },
    isFirstRender: { current: true },
    deletedRepostIdsRef: { current: null },
    quotedRef: { current: new Map() },
    profilesRef: { current: new Map() },
    applyPage: jest.fn((_page, items) => {
      visibleItems = items ?? [];
    }),
    appendPage: jest.fn(),
    applyEnrichment: jest.fn(),
    resetContent: jest.fn(() => {
      visibleItems = [];
    }),
    setIsLoading: jest.fn(),
    setIsLoadingMore: jest.fn(),
  };
  return { client, ctx, visibleItems: () => visibleItems };
}

describe('profile loading after posts arrive', () => {
  beforeEach(() => {
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 0);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps fetched posts visible when nagg enrichment rejects with 404', async () => {
    const { client, ctx, visibleItems } = setup();
    jest.mocked(client.enrich).mockRejectedValue(new Error('App-view fetch failed: 404 not found'));
    await loadUserFeedImpl(ctx, () => false);
    expect(visibleItems()).toEqual([item]);
    expect(ctx.resetContent).not.toHaveBeenCalled();
    expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('still applies successful enrichment to the fetched posts', async () => {
    const { client, ctx, visibleItems } = setup();
    const updates = { profiles: new Map([[item.event.pubkey, { name: 'Alice' }]]) };
    jest.mocked(client.enrich).mockResolvedValue(updates);
    await loadUserFeedImpl(ctx, () => false);
    expect(visibleItems()).toEqual([item]);
    expect(ctx.applyEnrichment).toHaveBeenCalledWith(updates);
  });

  it('clears the previous profile content when the initial page itself fails', async () => {
    const { client, ctx } = setup();
    jest.mocked(client.getUserFeed).mockRejectedValue(new Error('network down'));
    await loadUserFeedImpl(ctx, () => false);
    expect(ctx.resetContent).toHaveBeenCalledTimes(1);
    expect(ctx.applyPage).not.toHaveBeenCalled();
    expect(client.enrich).not.toHaveBeenCalled();
    expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('does not change a new profile after the old profile enrichment fails', async () => {
    const { client, ctx } = setup();
    let cancelled = false;
    jest.mocked(client.enrich).mockImplementation(async () => {
      cancelled = true;
      throw new Error('late failure');
    });
    await loadUserFeedImpl(ctx, () => cancelled);
    expect(ctx.resetContent).not.toHaveBeenCalled();
    expect(ctx.applyEnrichment).not.toHaveBeenCalled();
    expect(ctx.setIsLoading).toHaveBeenCalledTimes(1);
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });
});
