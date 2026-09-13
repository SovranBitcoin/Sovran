import { enrichUserFeedPage, fetchUserFeedPage } from '@/features/feed/lib/loadUserFeed';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import { emptyFeedParseResult, type FeedClient } from '@/features/feed/data/feedClient';
import type { FeedItem } from '@/features/feed/components/nostr/feedTypes';

jest.mock('@/features/feed/data/useFeedClient', () => ({ getFeedClient: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  feedLog: { info: jest.fn(), warn: jest.fn() },
  log: { error: jest.fn() },
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
  const page = {
    ...emptyFeedParseResult(),
    orderedFeedItems: [item],
    paginationUntil: 200,
    missingProfilePubkeys: [item.event.pubkey],
  };
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
  return { client, page };
}

const args = {
  pubkey: item.event.pubkey,
  authorName: undefined,
  authorPicture: undefined,
  signal: undefined,
  readId: 'r1-profileFeed',
};

describe('fetchUserFeedPage', () => {
  it('returns the page, forwards the read id, and disposes the client', async () => {
    const { client, page } = setup();
    await expect(fetchUserFeedPage(args)).resolves.toBe(page);
    expect(client.getUserFeed).toHaveBeenCalledWith(
      expect.objectContaining({ readId: 'r1-profileFeed', limit: 50 })
    );
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('throws on a tier-exhausted empty answer so it is never cached as "no posts"', async () => {
    const { client } = setup();
    jest.mocked(client.getUserFeed).mockResolvedValue({
      ...emptyFeedParseResult(),
      read: { status: 'unavailable', sources: [], attempts: ['nagg=failed'], degraded: true },
    });
    await expect(fetchUserFeedPage(args)).rejects.toThrow('profile feed unavailable');
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps an unavailable answer that still carries rows (degraded, not empty)', async () => {
    const { client, page } = setup();
    jest.mocked(client.getUserFeed).mockResolvedValue({
      ...page,
      read: {
        status: 'unavailable',
        sources: ['relay'],
        attempts: ['nagg=failed'],
        degraded: true,
      },
    });
    await expect(fetchUserFeedPage(args)).resolves.toMatchObject({ orderedFeedItems: [item] });
  });
});

describe('enrichUserFeedPage', () => {
  it('applies successful enrichment', async () => {
    const { client, page } = setup();
    const updates = { profiles: new Map([[item.event.pubkey, { name: 'Alice' }]]) };
    jest.mocked(client.enrich).mockResolvedValue(updates);
    const applyEnrichment = jest.fn();
    await enrichUserFeedPage(page, { isCancelled: () => false, applyEnrichment });
    expect(applyEnrichment).toHaveBeenCalledWith(updates);
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('never throws when nagg enrichment rejects with 404 — the posts stay', async () => {
    const { client, page } = setup();
    jest.mocked(client.enrich).mockRejectedValue(new Error('App-view fetch failed: 404 not found'));
    const applyEnrichment = jest.fn();
    await expect(
      enrichUserFeedPage(page, { isCancelled: () => false, applyEnrichment })
    ).resolves.toBeUndefined();
    expect(applyEnrichment).not.toHaveBeenCalled();
  });

  it('does not apply enrichment that completes after cancellation', async () => {
    const { client, page } = setup();
    let cancelled = false;
    jest.mocked(client.enrich).mockImplementation(async () => {
      cancelled = true;
      return { profiles: new Map() };
    });
    const applyEnrichment = jest.fn();
    await enrichUserFeedPage(page, { isCancelled: () => cancelled, applyEnrichment });
    expect(applyEnrichment).not.toHaveBeenCalled();
  });

  it('skips the round-trip when nothing is missing', async () => {
    const { client } = setup();
    await enrichUserFeedPage(
      { missingQuotedIds: [], missingProfilePubkeys: [] },
      { isCancelled: () => false, applyEnrichment: jest.fn() }
    );
    expect(client.enrich).not.toHaveBeenCalled();
  });
});
