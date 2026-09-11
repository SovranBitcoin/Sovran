import { composeThreadItems, type ThreadItem } from '../features/feed/lib/threadItems';
import type { FeedEvent } from '../features/feed/components/nostr/feedTypes';

// This suite exercises final presentation filtering, independent of fetching/thread construction.
jest.mock('nostr', () => ({ facade: {} }), { virtual: true });

const event = (id: string, pubkey: string): FeedEvent => ({
  id,
  pubkey,
  content: 'hidden text',
  tags: [],
  kind: 1,
  created_at: 1,
});

it('hides the target and parent of an already-open thread after blocking or hiding content', () => {
  const items: ThreadItem[] = [
    { type: 'parent', event: event('parent', 'blocked') },
    { type: 'target', event: event('target', 'blocked') },
    { type: 'reply', event: event('reply', 'allowed') },
  ];
  const byAuthor = composeThreadItems(
    items,
    [event('spam', 'blocked')],
    { pubkeys: new Set(['blocked']), eventIds: new Set() },
    { includeSpam: true }
  );
  expect(byAuthor).toEqual([items[2]]);
  const byId = composeThreadItems(
    items,
    [],
    { pubkeys: new Set(), eventIds: new Set(['target']) },
    { includeSpam: false }
  );
  expect(byId).toEqual([items[0], items[2]]);
  expect(
    composeThreadItems(
      items,
      [],
      { pubkeys: new Set(), eventIds: new Set() },
      { includeSpam: false }
    )
  ).toEqual(items);
});
