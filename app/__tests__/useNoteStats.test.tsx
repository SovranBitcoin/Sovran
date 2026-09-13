import { act, renderHook } from '@testing-library/react-native';
import { facade } from 'nostr';
import { useNoteStats } from '@/shared/lib/nostr/useEntityCache';

const mockCache = facade.createNostrEntityCache();
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ cache: mockCache }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (s: { mockMode: boolean }) => unknown) => selector({ mockMode: false }),
}));
jest.mock('@/shared/stores/runtime/mockPresentationData', () => ({ DEMO_PROFILES: new Map() }));

const N1 = '1'.repeat(64);
const N2 = '2'.repeat(64);

it('is absent until a source counts the note, loading while a backfill is pending, cached once counts land', () => {
  const { result } = renderHook(() => useNoteStats(N1));
  expect(result.current.status).toBe('absent');
  expect(result.current.metrics).toBeUndefined();

  act(() => mockCache.pendingNoteStats.begin([N1]));
  expect(result.current.status).toBe('loading');

  act(() => {
    mockCache.ingestNoteStats({ [N1]: { likes: 3, reposts: 1, replies: 2, zaps: 0, satsZapped: 21 } }, 'relay');
    mockCache.pendingNoteStats.end([N1]);
  });
  expect(result.current.status).toBe('cached');
  expect(result.current.metrics).toEqual({ likeCount: 3, repostCount: 1, replyCount: 2, satsZapped: 21 });
});

it('re-renders only for its own note id', () => {
  const { result } = renderHook(() => useNoteStats(N2));
  const before = result.current;
  act(() => {
    mockCache.ingestNoteStats({ [N1]: { likes: 9, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 } }, 'nagg');
  });
  expect(result.current).toBe(before);
  act(() => {
    mockCache.ingestNoteStats({ [N2]: { likes: 1, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 } }, 'nagg');
  });
  expect(result.current.metrics?.likeCount).toBe(1);
});

it('a nagg count is never overwritten by a later relay lower bound', () => {
  const { result } = renderHook(() => useNoteStats(N1));
  act(() => {
    mockCache.ingestNoteStats({ [N1]: { likes: 40, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 } }, 'nagg');
  });
  act(() => {
    mockCache.ingestNoteStats({ [N1]: { likes: 2, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 } }, 'relay');
  });
  expect(result.current.metrics?.likeCount).toBe(40);
});

it('an undefined id binds to nothing', () => {
  const { result } = renderHook(() => useNoteStats(undefined));
  expect(result.current.status).toBe('absent');
});
