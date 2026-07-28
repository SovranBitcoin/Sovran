/**
 * @jest-environment node
 *
 * Regression: navigating to a profile flashed placeholder → clay fallback →
 * real image. `isLoading` (isMissing && isFetching) is false on the first
 * render (the fetch effect hasn't run yet) and false for the whole
 * revalidation of a feed-seeded name-only record (stale, not missing), so
 * surfaces briefly rendered the generative fallback that the in-flight fetch
 * was about to replace. `isResolving` must cover both windows.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useCachedNostrProfile } from '@/shared/lib/nostr/useEntityCache';
import { fetchProfilesViaFacade } from '@/shared/lib/nostr/fetchProfiles';

jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  useCachedNostrProfile: jest.fn(),
  useProfileRecordsMany: jest.fn(() => new Map()),
}));

jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({
  fetchProfilesViaFacade: jest.fn(),
}));

const mockUseCachedNostrProfile = useCachedNostrProfile as jest.Mock;
const mockFetchProfiles = fetchProfilesViaFacade as jest.Mock;

const PUBKEY = 'a'.repeat(64);

function cacheState(state: {
  metadata?: { picture?: string; name?: string; fetchedAt?: number };
  isStale?: boolean;
  isMissing?: boolean;
}) {
  mockUseCachedNostrProfile.mockReturnValue({
    metadata: state.metadata,
    isStale: state.isStale ?? false,
    isMissing: state.isMissing ?? !state.metadata,
  });
}

describe('useNostrProfileMetadata isResolving', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is true on the very first render for a cache-missing pubkey', () => {
    cacheState({ isMissing: true });
    mockFetchProfiles.mockReturnValue(new Promise(() => {}));

    // Record every render's value: the first frame is the one that used to
    // flash the clay fallback (isLoading is false until the effect runs).
    const frames: { isLoading: boolean; isResolving: boolean }[] = [];
    renderHook(() => {
      const result = useNostrProfileMetadata(PUBKEY);
      frames.push({ isLoading: result.isLoading, isResolving: result.isResolving });
      return result;
    });

    expect(frames[0]!.isResolving).toBe(true);
    expect(frames.every((frame) => frame.isResolving)).toBe(true);
  });

  it('stays true while a seeded name-only record revalidates (stale, not missing)', () => {
    cacheState({
      metadata: { name: 'seeded-name', fetchedAt: 0 },
      isStale: true,
      isMissing: false,
    });
    mockFetchProfiles.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useNostrProfileMetadata(PUBKEY));

    // The seeded hint is served (name available for first paint)…
    expect(result.current.metadata).toEqual({ name: 'seeded-name', fetchedAt: 0 });
    expect(result.current.isLoading).toBe(false);
    // …but the avatar-deciding fetch is still in flight.
    expect(result.current.isResolving).toBe(true);
  });

  it('settles false once the fetch resolves with a profile', async () => {
    cacheState({ isMissing: true });
    mockFetchProfiles.mockResolvedValue({ [PUBKEY]: { picture: 'https://img' } });

    const { result, rerender } = renderHook(() => useNostrProfileMetadata(PUBKEY));
    await act(async () => {});

    // The facade write-throughs the entity cache; mirror that in the mock.
    cacheState({
      metadata: { picture: 'https://img', fetchedAt: Date.now() },
      isStale: false,
      isMissing: false,
    });
    rerender({});

    expect(result.current.isResolving).toBe(false);
    expect(result.current.metadata?.picture).toBe('https://img');
  });

  it('settles false after the retry attempts cap for a profile-less pubkey', async () => {
    jest.useFakeTimers();
    try {
      cacheState({ isMissing: true });
      mockFetchProfiles.mockResolvedValue({});

      const { result } = renderHook(() => useNostrProfileMetadata(PUBKEY));

      // 3 attempts, each followed by the retry backoff.
      for (let round = 0; round < 3; round += 1) {
        await act(async () => {});
        if (round < 2) {
          expect(result.current.isResolving).toBe(true);
          await act(async () => {
            jest.advanceTimersByTime(4_000);
          });
        }
      }

      await act(async () => {});
      expect(mockFetchProfiles).toHaveBeenCalledTimes(3);
      // Attempts exhausted with nothing found → the fallback may now show.
      expect(result.current.isResolving).toBe(false);
      expect(result.current.isLoading).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
