/**
 * @jest-environment node
 */

import {
  selectActiveProfile,
  useProfileStore,
  type ProfileEntry,
} from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

/**
 * `useProfileStore((s) => s.getActiveProfile())` walked the profile list on
 * every store update, in every component that asked who the user is.
 * `selectActiveProfile` is the selector those call sites use instead: it scans
 * only when the list or the active index is a different value, and returns the
 * entry it already found otherwise.
 */
const pubkey = (i: number) => `${i}`.padStart(64, '0');
const entry = (i: number): ProfileEntry => ({ accountIndex: i, pubkey: pubkey(i), addedAt: i });

const active = () => selectActiveProfile(useProfileStore.getState());

beforeEach(() =>
  useProfileStore.setState({ profiles: [entry(0), entry(1), entry(2)], activeAccountIndex: 1 })
);

describe('selectActiveProfile', () => {
  it('finds the entry the active index names', () => {
    expect(active()?.pubkey).toBe(pubkey(1));
  });

  it('returns nothing when no profile stands behind the active index', () => {
    useProfileStore.setState({ activeAccountIndex: 9 });
    expect(active()).toBeUndefined();
  });

  it('keeps one reference across updates that leave the active profile alone', () => {
    const before = active();

    // A set that changes nothing the selector reads.
    useProfileStore.setState({});
    expect(active()).toBe(before);

    // Another profile's balance replaces the list but not this entry.
    useProfileStore.getState().updateProfileBalance(2, 500);
    expect(active()).toBe(before);

    // So does adding a profile.
    useProfileStore.getState().addProfile(3, pubkey(3));
    expect(active()).toBe(before);
  });

  it("follows the active profile's own data", () => {
    const before = active();

    useProfileStore.getState().updateProfileMetadata(1, 'Satoshi', 'https://example.com/a.png');

    expect(active()).not.toBe(before);
    expect(active()).toMatchObject({ pubkey: pubkey(1), cachedDisplayName: 'Satoshi' });
  });

  it('follows the active index', () => {
    expect(useProfileStore.getState().switchProfile(2)).toBe(true);
    expect(active()?.pubkey).toBe(pubkey(2));

    expect(useProfileStore.getState().switchProfile(0)).toBe(true);
    expect(active()?.pubkey).toBe(pubkey(0));
  });

  it('does not walk the list again on an unrelated update', () => {
    const profiles = [entry(0), entry(1), entry(2)];
    const find = jest.spyOn(profiles, 'find');
    useProfileStore.setState({ profiles, activeAccountIndex: 1 });

    const first = active();
    expect(find).toHaveBeenCalledTimes(1);

    // Every store update re-runs every mounted selector; none of these change
    // the list or the active index.
    for (let i = 0; i < 5; i++) {
      useProfileStore.setState({});
      expect(active()).toBe(first);
    }
    expect(find).toHaveBeenCalledTimes(1);

    // A real change to an input scans once more, and only once.
    useProfileStore.setState({ activeAccountIndex: 2 });
    expect(active()?.pubkey).toBe(pubkey(2));
    expect(active()?.pubkey).toBe(pubkey(2));
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('is what the imperative getter returns', () => {
    expect(useProfileStore.getState().getActiveProfile()).toBe(active());
  });
});
