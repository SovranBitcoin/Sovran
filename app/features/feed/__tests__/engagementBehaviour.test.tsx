/**
 * What a note's row shows while the viewer likes, unlikes, reposts and zaps:
 * the optimistic answer, the settled answer after the publish, the rollback
 * when a publish fails, and the hand-over to confirmed counts.
 *
 * Every assertion reads the text a row renders, so the suite is indifferent to
 * how a row gets its engagement — only `NoteProbe` knows.
 */
import { act, render, renderHook, screen } from '@testing-library/react-native';
import { createElement } from 'react';

import type { FeedEvent, NoteMetrics } from '../components/nostr/feedTypes';
import type { ImageOverlayPost } from '../components/nostr/image-overlay/types';
import { useLiveOverlayPost } from '../components/nostr/image-overlay/useLiveOverlayPost';
import { useNostrEngagement } from '../hooks/useNostrEngagement';
import { useNoteEngagement } from '../hooks/useNoteEngagement';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

const mockPublish = jest.fn();
const mockPopup = jest.fn();
const mockCache = {
  metrics: new Map<string, NoteMetrics>(),
  listeners: new Set<() => void>(),
};

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  useNDK: () => ({ ndk: {} }),
  NDKEvent: class {},
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (args: unknown) => mockPublish(args),
}));
jest.mock('@/shared/lib/popup', () => ({
  paramPopup: (...args: unknown[]) => mockPopup(...args),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'viewer' } }),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  return {
    readNoteMetrics: (id: string) => mockCache.metrics.get(id),
    useNoteStats: (id: string | undefined) => {
      const metrics = useSyncExternalStore(
        (onChange: () => void) => {
          mockCache.listeners.add(onChange);
          return () => mockCache.listeners.delete(onChange);
        },
        () => (id ? mockCache.metrics.get(id) : undefined)
      );
      return { metrics, status: metrics ? 'cached' : 'absent' };
    },
  };
});

const note = (id: string): FeedEvent => ({
  id: id.repeat(64),
  pubkey: 'f'.repeat(64),
  kind: 1,
  created_at: 1,
  content: id,
  tags: [],
});
const A = note('a');
const B = note('b');
const EVENTS = [A, B];

const counts = (overrides: Partial<NoteMetrics> = {}): NoteMetrics => ({
  likeCount: 5,
  repostCount: 2,
  replyCount: 1,
  satsZapped: 500,
  ...overrides,
});

/** The entity cache learns new counts for a note, as a page or a thread read would teach it. */
function cacheCounts(event: FeedEvent, metrics: NoteMetrics) {
  mockCache.metrics.set(event.id, metrics);
  for (const listener of mockCache.listeners) listener();
}

type Shown = {
  likes: number;
  reposts: number;
  replies: number;
  sats: number;
  liked: boolean;
  reposted: boolean;
  replied: boolean;
  likePending: string;
  repostPending: string;
  zapped: boolean;
  zapPending: boolean;
};

/** One row: everything a card shows for a note's engagement, as text. */
function NoteProbe({ event, fallback }: { event: FeedEvent; fallback: NoteMetrics }) {
  const { metrics, state, zap } = useNoteEngagement(event.id, fallback);
  const shown: Shown = {
    likes: metrics.likeCount,
    reposts: metrics.repostCount,
    replies: metrics.replyCount,
    sats: metrics.satsZapped,
    liked: state.liked,
    reposted: state.reposted,
    replied: state.replied,
    likePending: state.likePending ? (state.likePendingDirection ?? 'pending') : 'no',
    repostPending: state.repostPending ? (state.repostPendingDirection ?? 'pending') : 'no',
    zapped: zap.zapped,
    zapPending: zap.zapPending,
  };
  return createElement('Text', { testID: `probe-${event.id}` }, JSON.stringify(shown));
}

let actions: Pick<ReturnType<typeof useNostrEngagement>, 'toggleLike' | 'toggleRepost'>;

function Surface({ getMetrics }: { getMetrics: (id: string) => NoteMetrics }) {
  const engagement = useNostrEngagement(EVENTS, getMetrics);
  actions = engagement;
  return (
    <>
      {EVENTS.map((event) => (
        <NoteProbe key={event.id} event={event} fallback={getMetrics(event.id)} />
      ))}
    </>
  );
}

const shown = (event: FeedEvent): Shown =>
  JSON.parse(screen.getByTestId(`probe-${event.id}`).props.children as string);

/** Lets a publish in flight resolve and the hook react to what it wrote. */
const settle = () => act(async () => {});

type Deferred = { resolve: () => void; reject: () => void };
/** The next publish stays in flight until the test decides how it ends. */
function holdNextPublish(ownEventId: string): Deferred {
  let finish!: (failed: boolean) => void;
  mockPublish.mockImplementationOnce(
    ({ event }: { event: { id?: string } }) =>
      new Promise((done) => {
        finish = (failed) => {
          if (!failed) event.id = ownEventId;
          done({ isErr: () => failed, error: failed ? new Error('relay said no') : undefined });
        };
      })
  );
  return { resolve: () => finish(false), reject: () => finish(true) };
}

function mount(surface: Partial<Record<string, NoteMetrics>> = {}) {
  const getMetrics = (id: string) => surface[id] ?? counts();
  return render(<Surface getMetrics={getMetrics} />);
}

function confirm(event: FeedEvent, action: 'liked' | 'reposted', ownEventId?: string) {
  act(() => {
    useNostrSocialStore.setState((state) => ({
      engagementByEventId: {
        ...state.engagementByEventId,
        [event.id]: {
          ...state.engagementByEventId[event.id],
          [action]: ownEventId ? { ownEventId } : {},
          updatedAt: Date.now(),
        },
      },
    }));
  });
}

beforeEach(() => {
  mockPublish.mockReset();
  mockPopup.mockReset();
  mockCache.metrics.clear();
  mockCache.listeners.clear();
  useNostrSocialStore.setState({
    engagementByEventId: {},
    optimisticLikesByEventId: {},
    optimisticRepostsByEventId: {},
    optimisticZapsByEventId: {},
    zappedByEventId: {},
  });
});

describe('like', () => {
  it('answers at once, then settles when the publish lands', async () => {
    const publish = holdNextPublish('own-like');
    mount();
    expect(shown(A)).toMatchObject({ likes: 5, liked: false, likePending: 'no' });

    act(() => actions.toggleLike(A));
    expect(shown(A)).toMatchObject({ likes: 6, liked: true, likePending: 'activating' });
    expect(shown(B)).toMatchObject({ likes: 5, liked: false, likePending: 'no' });

    publish.resolve();
    await settle();
    expect(shown(A)).toMatchObject({ likes: 6, liked: true, likePending: 'no' });
    expect(useNostrSocialStore.getState().optimisticLikesByEventId[A.id]).toMatchObject({
      relatedEventId: 'own-like',
      pending: false,
    });
  });

  it('rolls back when the publish fails', async () => {
    const publish = holdNextPublish('never');
    mount();

    act(() => actions.toggleLike(A));
    expect(shown(A)).toMatchObject({ likes: 6, liked: true, likePending: 'activating' });

    publish.reject();
    await settle();
    expect(shown(A)).toMatchObject({ likes: 5, liked: false, likePending: 'no' });
    expect(useNostrSocialStore.getState().optimisticLikesByEventId[A.id]).toBeUndefined();
    expect(mockPopup).toHaveBeenCalledWith(
      'engagement-update-failed',
      'like',
      expect.objectContaining({ failure: expect.anything() })
    );
  });

  it('unlikes a confirmed like, and restores it when the retraction fails', async () => {
    mount({ [A.id]: counts({ likeCount: 6 }) });
    confirm(A, 'liked', 'own-like');
    expect(shown(A)).toMatchObject({ likes: 6, liked: true });

    const retraction = holdNextPublish('deletion');
    act(() => actions.toggleLike(A));
    expect(shown(A)).toMatchObject({ likes: 5, liked: false, likePending: 'deactivating' });

    retraction.reject();
    await settle();
    expect(shown(A)).toMatchObject({ likes: 6, liked: true, likePending: 'no' });
  });

  it('follows the latest tap when unliked while the like is still publishing', async () => {
    const like = holdNextPublish('own-like');
    const retraction = holdNextPublish('deletion');
    mount();

    act(() => actions.toggleLike(A));
    act(() => actions.toggleLike(A));
    expect(shown(A)).toMatchObject({ likes: 5, liked: false, likePending: 'deactivating' });

    like.resolve();
    await settle();
    retraction.resolve();
    await settle();
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(shown(A)).toMatchObject({ likes: 5, liked: false, likePending: 'no' });
  });

  it('refuses to unlike a like it holds no event for', () => {
    mount({ [A.id]: counts({ likeCount: 6 }) });
    confirm(A, 'liked');

    act(() => actions.toggleLike(A));
    expect(shown(A)).toMatchObject({ likes: 6, liked: true, likePending: 'no' });
    expect(mockPopup).toHaveBeenCalledWith('engagement-update-failed', 'like');
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe('repost', () => {
  it('answers at once, settles, and leaves the like alone', async () => {
    const publish = holdNextPublish('own-repost');
    mount();

    act(() => actions.toggleRepost(A));
    expect(shown(A)).toMatchObject({
      reposts: 3,
      reposted: true,
      repostPending: 'activating',
      likes: 5,
      liked: false,
    });
    expect(shown(B)).toMatchObject({ reposts: 2, reposted: false });

    publish.resolve();
    await settle();
    expect(shown(A)).toMatchObject({ reposts: 3, reposted: true, repostPending: 'no' });
  });

  it('rolls back when the publish fails', async () => {
    const publish = holdNextPublish('never');
    mount();

    act(() => actions.toggleRepost(A));
    publish.reject();
    await settle();
    expect(shown(A)).toMatchObject({ reposts: 2, reposted: false, repostPending: 'no' });
    expect(mockPopup).toHaveBeenCalledWith(
      'engagement-update-failed',
      'repost',
      expect.objectContaining({ failure: expect.anything() })
    );
  });
});

describe('hand-over to confirmed counts', () => {
  it('keeps the expected count until the shared count catches up, then drops the overlay', async () => {
    const publish = holdNextPublish('own-like');
    const view = mount();
    act(() => actions.toggleLike(A));
    publish.resolve();
    await settle();

    // Our own reaction is seen by the sync, but the aggregate still says 5.
    confirm(A, 'liked', 'own-like');
    await settle();
    expect(shown(A)).toMatchObject({ likes: 6, liked: true });
    expect(useNostrSocialStore.getState().optimisticLikesByEventId[A.id]).toBeDefined();

    // A fresh page lands: the cache and the surface both learn the new count.
    act(() => cacheCounts(A, counts({ likeCount: 7 })));
    view.rerender(<Surface getMetrics={() => counts({ likeCount: 7 })} />);
    await settle();
    expect(useNostrSocialStore.getState().optimisticLikesByEventId[A.id]).toBeUndefined();
    expect(shown(A)).toMatchObject({ likes: 7, liked: true, likePending: 'no' });
  });

  it('does not count the viewer twice when the base already includes the like', async () => {
    const publish = holdNextPublish('own-like');
    mount();
    act(() => actions.toggleLike(A));
    publish.resolve();
    await settle();

    act(() => cacheCounts(A, counts({ likeCount: 6 })));
    expect(shown(A)).toMatchObject({ likes: 6, liked: true });
  });

  it('prefers the shared cache over the surface for the base count', () => {
    cacheCounts(B, counts({ likeCount: 40, replyCount: 9 }));
    mount();
    expect(shown(B)).toMatchObject({ likes: 40, replies: 9 });
    expect(shown(A)).toMatchObject({ likes: 5, replies: 1 });
  });
});

describe('image overlay', () => {
  const opened: ImageOverlayPost = {
    event: A,
    metrics: counts(),
    liked: false,
    reposted: false,
  };

  function mountOverlay(getBaseMetrics?: (id: string) => NoteMetrics) {
    let renders = 0;
    const view = renderHook(() => {
      renders += 1;
      return useLiveOverlayPost(opened, getBaseMetrics);
    });
    return { view, renders: () => renders };
  }

  it('follows the note it shows and ignores every other note', () => {
    const { view, renders } = mountOverlay(() => counts());
    const before = view.result.current;
    expect(before).toMatchObject({ liked: false, metrics: { likeCount: 5 } });

    act(() =>
      useNostrSocialStore
        .getState()
        .setLikeOptimistic(B.id, { value: true, pending: true, delta: 1, expectedCount: 6 })
    );
    expect(renders()).toBe(1);
    expect(view.result.current).toBe(before);

    act(() =>
      useNostrSocialStore
        .getState()
        .setLikeOptimistic(A.id, { value: true, pending: true, delta: 1, expectedCount: 6 })
    );
    expect(renders()).toBe(2);
    expect(view.result.current).toMatchObject({
      liked: true,
      likePending: true,
      likePendingDirection: 'activating',
      metrics: { likeCount: 6 },
    });
  });

  it('shows the post as it was opened when the surface supplies no counts', () => {
    const { view, renders } = mountOverlay();
    act(() =>
      useNostrSocialStore
        .getState()
        .setLikeOptimistic(A.id, { value: true, pending: true, delta: 1, expectedCount: 6 })
    );
    expect(renders()).toBe(1);
    expect(view.result.current).toBe(opened);
  });
});

describe('zap', () => {
  it('adds the paid sats, keeps the tint after the aggregate catches up', async () => {
    const view = mount();
    expect(shown(A)).toMatchObject({ sats: 500, zapped: false, zapPending: false });

    act(() => useNostrSocialStore.getState().recordZapPaid(A.id, 21, 500));
    expect(shown(A)).toMatchObject({ sats: 521, zapped: true, zapPending: false });
    expect(shown(B)).toMatchObject({ sats: 500, zapped: false });

    act(() => cacheCounts(A, counts({ satsZapped: 521 })));
    view.rerender(<Surface getMetrics={() => counts({ satsZapped: 521 })} />);
    await settle();
    expect(useNostrSocialStore.getState().optimisticZapsByEventId[A.id]).toBeUndefined();
    expect(shown(A)).toMatchObject({ sats: 521, zapped: true });
  });
});
