import { ShortTextNote } from 'nostr-tools/kinds';

import { softSortRepliesForSkeletons } from '@/features/feed/lib/threadReplySkeletons';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

function reply(id: string, content: string, createdAt: number): FeedEvent {
  return {
    id,
    kind: ShortTextNote,
    pubkey: 'a'.repeat(64),
    content,
    tags: [],
    created_at: createdAt,
  };
}

describe('softSortRepliesForSkeletons', () => {
  it('prioritizes matching the first visible skeleton rows while keeping the rest stable', () => {
    const longReply = reply(
      'long',
      'This is a much longer reply that should occupy multiple visual lines once rendered in the thread view content column.',
      1
    );
    const shortReply = reply('short', 'Tiny reply.', 2);
    const mediumReply = reply(
      'medium',
      'This reply should land around the two-line skeleton shape after wrapping.',
      3
    );
    const laterReply = reply('later', 'Later stays after the matched visible slots.', 4);

    const sorted = softSortRepliesForSkeletons([longReply, shortReply, mediumReply, laterReply], 3);

    expect(sorted.map((event) => event.id)).toEqual(['short', 'later', 'medium', 'long']);
  });

  it('does not reorder when only one skeleton slot is being replaced', () => {
    const replies = [reply('long', 'A longer reply that might wrap across lines.', 1)];

    expect(softSortRepliesForSkeletons(replies, 1)).toEqual(replies);
  });
});
