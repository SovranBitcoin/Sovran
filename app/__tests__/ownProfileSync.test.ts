/**
 * @jest-environment node
 *
 * `syncOwnProfiles`, the launch refresh of the person's own accounts from the
 * app-view `/nostr/profile` endpoint: what it asks for, and what it writes to
 * the real profile store (the account switcher's cached name and picture),
 * the own-profile stats cache and the shared entity cache. The endpoint and
 * the entity-cache ingest are replaced.
 *
 * Unlike the relay-fed own-profile path (pinned in
 * useOwnEventsSync.test.tsx), this path carries no event timestamp at all, so
 * there is no equal-timestamp case: every answer is written as it comes.
 */
import { err, ok } from 'neverthrow';

import { syncOwnProfiles } from '@/shared/lib/profile/ownProfileSync';
import { ownProfileStatsCache } from '@/shared/lib/profile/ownProfileStatsStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';

const mockFetchNostrProfile = jest.fn();
const mockIngestResolvedProfiles = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('@/shared/lib/apiClient', () => ({
  fetchNostrProfile: (...args: unknown[]) => mockFetchNostrProfile(...args),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  ingestResolvedProfiles: (...args: unknown[]) => mockIngestResolvedProfiles(...args),
}));

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);

const account = (pubkey: string) =>
  useProfileStore.getState().profiles.find((p) => p.pubkey === pubkey);

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockFetchNostrProfile.mockReset();
  mockIngestResolvedProfiles.mockReset();
  useProfileStore.setState({
    profiles: [
      {
        accountIndex: 0,
        pubkey: A,
        addedAt: 1,
        cachedDisplayName: 'old A',
        cachedPicture: 'https://p/a0',
      },
      { accountIndex: 1, pubkey: B, addedAt: 2, cachedDisplayName: 'old B' },
    ],
    activeAccountIndex: 0,
  });
  ownProfileStatsCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('syncOwnProfiles', () => {
  it('fetches every own account and writes names, pictures and counts', async () => {
    mockFetchNostrProfile.mockImplementation(async (pubkey: string) =>
      pubkey === A
        ? ok({
            displayName: 'Alice',
            name: 'alice',
            picture: 'https://p/a1',
            followers: 10,
            follows: 3,
          })
        : ok({ name: 'bob', followers: 1, follows: 2 })
    );

    await syncOwnProfiles();

    expect(mockFetchNostrProfile.mock.calls.map(([pubkey]) => pubkey).sort()).toEqual(
      [A, B].sort()
    );
    expect(account(A)).toMatchObject({ cachedDisplayName: 'Alice', cachedPicture: 'https://p/a1' });
    // The display name falls back to name; no picture in the answer clears it.
    expect(account(B)).toMatchObject({ cachedDisplayName: 'bob' });
    expect(account(B)?.cachedPicture).toBeUndefined();
    expect(ownProfileStatsCache.getEntry(A)?.data).toEqual({ followers: 10, follows: 3 });
    expect(ownProfileStatsCache.getEntry(B)?.data).toEqual({ followers: 1, follows: 2 });
    expect(mockIngestResolvedProfiles).toHaveBeenCalledTimes(1);
    expect(mockIngestResolvedProfiles).toHaveBeenCalledWith({
      [A]: { displayName: 'Alice', name: 'alice', picture: 'https://p/a1' },
      [B]: { displayName: 'bob', name: 'bob', picture: undefined },
    });
  });

  it('passes the abort signal to each fetch and fetches nothing once aborted', async () => {
    mockFetchNostrProfile.mockResolvedValue(ok({ name: 'x' }));
    const controller = new AbortController();
    await syncOwnProfiles(controller.signal);
    expect(mockFetchNostrProfile.mock.calls[0][1]).toEqual({ signal: controller.signal });

    mockFetchNostrProfile.mockClear();
    controller.abort();
    await syncOwnProfiles(controller.signal);
    expect(mockFetchNostrProfile).not.toHaveBeenCalled();
  });

  it('leaves an account untouched when its fetch fails, and still updates the others', async () => {
    mockFetchNostrProfile.mockImplementation(async (pubkey: string) =>
      pubkey === A ? err(new Error('500')) : ok({ name: 'bob', followers: 1, follows: 2 })
    );

    await syncOwnProfiles();

    expect(account(A)).toMatchObject({ cachedDisplayName: 'old A', cachedPicture: 'https://p/a0' });
    expect(account(B)).toMatchObject({ cachedDisplayName: 'bob' });
    expect(ownProfileStatsCache.getEntry(A)).toBeUndefined();
    expect(Object.keys(mockIngestResolvedProfiles.mock.calls[0][0])).toEqual([B]);
  });

  it('writes no counts unless both followers and follows are numbers', async () => {
    mockFetchNostrProfile.mockResolvedValue(ok({ name: 'x', followers: 5 }));
    await syncOwnProfiles();
    expect(ownProfileStatsCache.getEntry(A)).toBeUndefined();
  });

  it('replaces the cached name with whatever the app view answers, even an empty profile', async () => {
    mockFetchNostrProfile.mockResolvedValue(ok({}));
    await syncOwnProfiles();
    // QUIRK: with no timestamp to compare, an answer with no name or picture
    // (a stale or empty app-view record) wipes the cached label and picture.
    expect(account(A)?.cachedDisplayName).toBeUndefined();
    expect(account(A)?.cachedPicture).toBeUndefined();
  });

  it('does nothing without accounts', async () => {
    useProfileStore.setState({ profiles: [] });
    await syncOwnProfiles();
    expect(mockFetchNostrProfile).not.toHaveBeenCalled();
    expect(mockIngestResolvedProfiles).not.toHaveBeenCalled();
  });
});
