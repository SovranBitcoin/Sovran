import { ok } from 'neverthrow';
import type { facade } from 'nostr';
import { createFacadeFeedClient } from '@/features/feed/data/facadeFeedClient';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import type { FeedClient } from '@/features/feed/data/feedClient';

jest.mock('nostr', () => ({ facade: {} }));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({ buildNostrDataLayer: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({ feedLog: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('@/shared/stores/runtime/debugTierStore', () => ({ recordDebugTiers: jest.fn() }));

const PUB = 'a'.repeat(64);
const ROOT = 'b'.repeat(64);
const REPLY = 'c'.repeat(64);

function page(id: string, createdAt: number, reply = false): facade.ResolvedFeedPage {
  return {
    tier: 'relay',
    items: [
      {
        type: 'note',
        event: {
          id,
          pubkey: PUB,
          kind: 1,
          content: 'post',
          created_at: createdAt,
          tags: reply ? [['e', ROOT, '', 'reply']] : [],
        },
      },
    ],
    stats: {},
    profiles: {},
    quoted: {},
    missingIds: [],
    cursor: { createdAt, id },
  };
}

function setup(...pages: facade.ResolvedFeedPage[]) {
  const getFeedPage = jest.fn();
  for (const next of pages) getFeedPage.mockResolvedValueOnce(ok(next));
  jest
    .mocked(buildNostrDataLayer)
    .mockReturnValue({ getFeedPage } as unknown as facade.NostrDataLayer);
  const fallback: Omit<FeedClient, 'getThread'> = {
    getFeed: jest.fn(),
    getUserFeed: jest.fn(),
    getPostsByPubkeys: jest.fn(),
    enrich: jest.fn(),
    getNotifications: jest.fn(),
  };
  const client = createFacadeFeedClient(fallback);
  return { client, getFeedPage };
}

describe('profile post loading', () => {
  it('continues past a reply-only relay page to find authored posts', async () => {
    const { client, getFeedPage } = setup(page(REPLY, 200, true), page(ROOT, 100));
    const result = await client.getUserFeed({ pubkey: PUB, limit: 50 });
    expect(result.orderedFeedItems.map((item) => item.type === 'note' && item.event.id)).toEqual([
      ROOT,
    ]);
    expect(getFeedPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { createdAt: 200, id: REPLY } })
    );
    expect(result.paginationUntil).toBe(100);
  });

  it('stops when the source repeats the same reply-only cursor', async () => {
    const replyPage = page(REPLY, 200, true);
    const { client, getFeedPage } = setup(replyPage, replyPage);
    const result = await client.getUserFeed({ pubkey: PUB });
    expect(result.orderedFeedItems).toEqual([]);
    expect(getFeedPage).toHaveBeenCalledTimes(2);
  });

  it('returns a healthy nagg page without fetching another page', async () => {
    const { client, getFeedPage } = setup({ ...page(ROOT, 100), tier: 'nagg' });
    const result = await client.getUserFeed({ pubkey: PUB });
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(getFeedPage).toHaveBeenCalledTimes(1);
  });

  it('continues past reply-only pages during pagination as well as initial loading', async () => {
    const { client, getFeedPage } = setup(page(REPLY, 200, true), page(ROOT, 100));
    const result = await client.getUserFeed({ pubkey: PUB, until: 300 });
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.paginationUntil).toBe(100);
    expect(getFeedPage).toHaveBeenCalledTimes(2);
  });

  it('stops when the source runs out of history', async () => {
    const { client, getFeedPage } = setup(page(REPLY, 200, true), {
      ...page(ROOT, 100),
      items: [],
      cursor: null,
    });
    const result = await client.getUserFeed({ pubkey: PUB });
    expect(result.orderedFeedItems).toEqual([]);
    expect(getFeedPage).toHaveBeenCalledTimes(2);
  });

  it('does not fetch more pages after cancellation', async () => {
    const { client, getFeedPage } = setup(page(REPLY, 200, true));
    const controller = new AbortController();
    controller.abort();
    await client.getUserFeed({ pubkey: PUB, signal: controller.signal });
    expect(getFeedPage).toHaveBeenCalledTimes(1);
  });
});
