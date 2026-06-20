/**
 * Unit tests for partitionOwnEvents — the pure routing of our own events into
 * per-store rows. Focuses on the bug-prone bits: reply-target detection
 * (NIP-10 markers vs quotes/mentions), like content filtering, and dedupe of
 * latest profile/contacts.
 */
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { partitionOwnEvents } from '@/shared/lib/nostr/ownsync/partitionOwnEvents';

function ev(over: Partial<FeedEvent> & { kind: number }): FeedEvent {
  return {
    id: over.id ?? 'id',
    kind: over.kind,
    pubkey: over.pubkey ?? 'me',
    content: over.content ?? '',
    tags: over.tags ?? [],
    created_at: over.created_at ?? 1000,
  };
}

describe('partitionOwnEvents', () => {
  it('routes likes from kind:7 with a + / empty reaction, skips other reactions', () => {
    const part = partitionOwnEvents([
      ev({ kind: 7, id: 'r1', content: '+', tags: [['e', 'target1']] }),
      ev({ kind: 7, id: 'r2', content: '', tags: [['e', 'target2']] }),
      ev({ kind: 7, id: 'r3', content: '😀', tags: [['e', 'target3']] }), // not a like
      ev({ kind: 7, id: 'r4', content: '+', tags: [] }), // no target
    ]);
    expect(part.likes).toEqual([
      { targetEventId: 'target1', reactionEventId: 'r1', createdAt: 1000 },
      { targetEventId: 'target2', reactionEventId: 'r2', createdAt: 1000 },
    ]);
  });

  it('routes reposts from kind:6 by their e-tag target', () => {
    const part = partitionOwnEvents([ev({ kind: 6, id: 'rp1', tags: [['e', 'orig1']] })]);
    expect(part.reposts).toEqual([
      { targetEventId: 'orig1', repostEventId: 'rp1', createdAt: 1000 },
    ]);
  });

  it('detects replies via NIP-10 markers but not quotes/mentions or top-level notes', () => {
    const part = partitionOwnEvents([
      // reply-marked → parent2
      ev({
        kind: 1,
        id: 'a',
        tags: [
          ['e', 'root1', '', 'root'],
          ['e', 'parent2', '', 'reply'],
        ],
      }),
      // only root marker → root3
      ev({ kind: 1, id: 'b', tags: [['e', 'root3', '', 'root']] }),
      // legacy positional (unmarked) → last e-tag
      ev({
        kind: 1,
        id: 'c',
        tags: [
          ['e', 'x'],
          ['e', 'last4'],
        ],
      }),
      // quote/mention only → NOT a reply
      ev({
        kind: 1,
        id: 'd',
        tags: [
          ['e', 'quoted5', '', 'mention'],
          ['q', 'quoted5'],
        ],
      }),
      // top-level note → NOT a reply
      ev({ kind: 1, id: 'e', tags: [] }),
    ]);

    expect(part.replies).toEqual([
      { targetEventId: 'parent2', replyEventId: 'a', createdAt: 1000 },
      { targetEventId: 'root3', replyEventId: 'b', createdAt: 1000 },
      { targetEventId: 'last4', replyEventId: 'c', createdAt: 1000 },
    ]);
    // All kind:1 (incl. quote + top-level) are captured as own notes.
    expect(part.ownNotes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps only the newest profile (kind:0) and contacts (kind:3)', () => {
    const part = partitionOwnEvents([
      ev({ kind: 0, id: 'p-old', created_at: 100 }),
      ev({ kind: 0, id: 'p-new', created_at: 200 }),
      ev({ kind: 3, id: 'c-new', created_at: 500 }),
      ev({ kind: 3, id: 'c-old', created_at: 400 }),
    ]);
    expect(part.latestProfile?.id).toBe('p-new');
    expect(part.latestContacts?.id).toBe('c-new');
  });

  it('collects deletion target ids from kind:5 e-tags', () => {
    const part = partitionOwnEvents([
      ev({
        kind: 5,
        id: 'del',
        tags: [
          ['e', 'gone1'],
          ['e', 'gone2'],
          ['k', '7'],
        ],
      }),
    ]);
    expect(part.deletedEventIds).toEqual(['gone1', 'gone2']);
  });
});
