import {
  resolvedNotificationsToResult,
  toFacadeNotificationsRequest,
} from '@/features/feed/data/facadeNotificationsAdapter';

const TARGET = 'a'.repeat(64);
const PUB = 'c'.repeat(64);
const ACTOR = 'd'.repeat(64);

function event(id: string, created_at: number) {
  return { id, kind: 1, pubkey: PUB, content: `e ${id}`, tags: [], created_at };
}

describe('toFacadeNotificationsRequest', () => {
  it('maps ALL/MENTIONS tabs + until→cursor; falls back (null) for APP', () => {
    const req = toFacadeNotificationsRequest({
      viewerPubkey: PUB,
      tab: 'MENTIONS',
      until: 500,
      limit: 30,
    });
    expect(req?.tab).toBe('MENTIONS');
    expect(req?.cursor).toEqual({ createdAt: 500, id: '' });
    expect(toFacadeNotificationsRequest({ viewerPubkey: PUB, tab: 'APP' as never })).toBeNull();
  });
});

describe('resolvedNotificationsToResult', () => {
  it('maps grouped + single notifications, stats→metrics, and paging', () => {
    const result = resolvedNotificationsToResult({
      tier: 'nagg',
      grouped: true,
      notifications: [
        {
          type: 'group',
          event: event(TARGET, 200),
          reason: 'reaction',
          actorVertexScore: 0,
          total: 12,
          totalCapped: false,
          sampleActors: [{ pubkey: ACTOR, eventId: 'f'.repeat(64), createdAt: 200 }],
          targetEventId: TARGET,
        },
        { type: 'single', event: event('b'.repeat(64), 100), reason: 'reply', actorVertexScore: 0 },
      ],
      stats: { [TARGET]: { likes: 12, reposts: 0, replies: 1, zaps: 0, satsZapped: 0 } },
      profiles: { [PUB]: { name: 'alice' } },
      quoted: {},
      cursor: { createdAt: 100, id: 'b'.repeat(64) },
      missingIds: [],
    });

    expect(result.notifications).toHaveLength(2);
    const grouped = result.notifications[0];
    expect(grouped.type).toBe('group');
    expect(grouped.total).toBe(12);
    expect(grouped.targetEventId).toBe(TARGET);
    expect(grouped.sampleActors?.[0]?.pubkey).toBe(ACTOR);
    expect(result.metricsMap.get(TARGET)?.likeCount).toBe(12);
    expect(result.profilesMap.get(PUB)?.name).toBe('alice');
    expect(result.paginationUntil).toBe(100);
    expect(result.hasNextPage).toBe(true);
  });

  it('an empty page reports no next page', () => {
    const result = resolvedNotificationsToResult({
      tier: 'relay',
      grouped: false,
      notifications: [],
      stats: {},
      profiles: {},
      quoted: {},
      cursor: null,
      missingIds: [],
    });
    expect(result.notifications).toEqual([]);
    expect(result.hasNextPage).toBe(false);
  });
});
