import { describe, expect, test } from 'vitest';
import {
  authoredReplyChainInput,
  followingPopularRankedEventsInput,
  forYouRankedEventsInput,
  mergeRelevantReplyNodes,
  threadReplyRankInput,
} from '../src/recipes';

const root = {
  id: '1'.repeat(64),
  pubkey: 'a'.repeat(64),
  kind: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  content: 'root',
  tags: [],
};

function reply(idChar: string, parentId: string, pubkey = root.pubkey) {
  return {
    id: idChar.repeat(64),
    pubkey,
    kind: 1,
    createdAt: `2026-01-01T00:00:0${Number.parseInt(idChar, 16) % 9}.000Z`,
    content: idChar,
    tags: [['e', parentId, '', 'reply']],
  };
}

describe('rank recipes', () => {
  test('authored reply chain input stays generic and bounded', () => {
    expect(authoredReplyChainInput({ maxBranchFanout: 32 })).toEqual({
      kinds: [1, 1111],
      via: { key: 'e' },
      target: 'EVENT_ID',
      maxDepth: 8,
      maxBranchFanout: 32,
    });
    expect(JSON.stringify(authoredReplyChainInput())).not.toContain('sourceEventAuthor');
  });

  test('relevant thread rank includes engagement, vertex, recency, and viewer boost', () => {
    const rank = threadReplyRankInput('relevant', {
      viewerPubkey: 'b'.repeat(64),
      shuffle: { seed: '1', counter: 2 },
    });

    expect(rank?.terms?.some((term) => term.pubkeyScore?.source === 'vertex')).toBe(true);
    expect(rank?.terms?.some((term) => term.candidateField === 'CREATED_AT')).toBe(true);
    expect(rank?.candidatePubkeyBoosts?.length).toBe(1);
    expect(rank?.shuffle?.counter).toBe(2);
  });

  test('feed recipes keep for-you and following popular distinct', () => {
    const forYou = forYouRankedEventsInput({ viewerPubkey: 'b'.repeat(64), limit: 20 });
    const following = followingPopularRankedEventsInput({ viewerPubkey: 'b'.repeat(64), limit: 20 });

    expect(forYou.target?.pubkeysFrom).toBeUndefined();
    expect(following.target?.pubkeysFrom).toBeDefined();
    expect(forYou.terms?.some((term) => term.pubkeyScore)).toBe(true);
    expect(following.terms?.some((term) => term.pubkeyScore)).toBe(true);
  });
});

describe('reply graph', () => {
  test('orders author chain, followed tail, ranked rest, then fallback rest', () => {
    const authorOne = reply('2', root.id);
    const authorTwo = reply('3', authorOne.id);
    const followedTail = reply('4', authorTwo.id, 'b'.repeat(64));
    const rankedOther = reply('5', root.id, 'c'.repeat(64));
    const fallbackOther = reply('6', root.id, 'd'.repeat(64));

    const merged = mergeRelevantReplyNodes({
      sourceEvent: root,
      authorNodes: [authorTwo, authorOne],
      followedNodes: [followedTail],
      rankedNodes: [rankedOther],
      allNodes: [fallbackOther, rankedOther, authorOne],
      limit: 10,
      toEvent: (node) => node ?? undefined,
    });

    expect(merged.nodes.map((node) => node.id)).toEqual([
      authorOne.id,
      authorTwo.id,
      followedTail.id,
      rankedOther.id,
      fallbackOther.id,
    ]);
    expect(merged.authorChainIds).toEqual([authorOne.id, authorTwo.id]);
  });
});
