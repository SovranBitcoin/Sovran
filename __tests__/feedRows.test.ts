import { buildFeedRows } from '@/features/feed/lib/feedRows';
import type {
  FeedEvent,
  FeedItem,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';

const DEFAULT_METRICS: NoteMetrics = {
  likeCount: 0,
  repostCount: 0,
  replyCount: 0,
  satsZapped: 0,
};

const DEFAULT_ENGAGEMENT = {
  liked: false,
  reposted: false,
  likePending: false,
  repostPending: false,
};

function event(overrides: Partial<FeedEvent>): FeedEvent {
  return {
    id: overrides.id ?? 'e'.repeat(64),
    kind: overrides.kind ?? 1,
    pubkey: overrides.pubkey ?? 'p'.repeat(64),
    content: overrides.content ?? '',
    tags: overrides.tags ?? [],
    created_at: overrides.created_at ?? 1,
  };
}

function note(itemEvent: FeedEvent): FeedItem {
  return {
    type: 'note',
    event: itemEvent,
    timestamp: itemEvent.created_at,
  };
}

function buildRows(params: {
  items: FeedItem[];
  previousRows?: ReturnType<typeof buildFeedRows>;
  metrics?: Map<string, NoteMetrics>;
  profiles?: Map<string, ProfileInfo>;
  quotedEvents?: Map<string, FeedEvent>;
}) {
  const metrics = params.metrics ?? new Map<string, NoteMetrics>();
  return buildFeedRows({
    items: params.items,
    previousRows: params.previousRows ?? [],
    profilesMap: params.profiles ?? new Map<string, ProfileInfo>(),
    quotedEventsMap: params.quotedEvents ?? new Map<string, FeedEvent>(),
    getDisplayMetrics: (eventId) => metrics.get(eventId) ?? DEFAULT_METRICS,
    getEngagementState: () => DEFAULT_ENGAGEMENT,
  });
}

describe('buildFeedRows', () => {
  it('reuses a row when only unrelated maps change', () => {
    const item = note(event({ id: '1'.repeat(64), pubkey: 'a'.repeat(64) }));
    const first = buildRows({ items: [item] });
    const second = buildRows({
      items: [item],
      previousRows: first,
      profiles: new Map([['b'.repeat(64), { name: 'Unrelated' }]]),
    });

    expect(second[0]).toBe(first[0]);
  });

  it('replaces only the row whose visible metrics changed', () => {
    const firstId = '1'.repeat(64);
    const secondId = '2'.repeat(64);
    const firstItem = note(event({ id: firstId, pubkey: 'a'.repeat(64) }));
    const secondItem = note(event({ id: secondId, pubkey: 'b'.repeat(64) }));
    const first = buildRows({ items: [firstItem, secondItem] });
    const second = buildRows({
      items: [firstItem, secondItem],
      previousRows: first,
      metrics: new Map([[secondId, { ...DEFAULT_METRICS, likeCount: 1 }]]),
    });

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it('replaces a row when its quoted event becomes available', () => {
    const quoteId = '3'.repeat(64);
    const item = note(
      event({
        id: '1'.repeat(64),
        pubkey: 'a'.repeat(64),
        tags: [['q', quoteId]],
      })
    );
    const quoted = event({ id: quoteId, pubkey: 'c'.repeat(64), content: 'quoted' });
    const first = buildRows({ items: [item] });
    const second = buildRows({
      items: [item],
      previousRows: first,
      quotedEvents: new Map([[quoteId, quoted]]),
    });

    expect(second[0]).not.toBe(first[0]);
    expect(second[0]?.quotedEvents.get(quoteId)).toBe(quoted);
  });
});
