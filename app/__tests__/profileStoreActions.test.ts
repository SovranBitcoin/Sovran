/**
 * @jest-environment node
 *
 * Characterization of the `profile-store` actions not already pinned by
 * profileStoreCapacity / profileWalletPhraseFingerprint /
 * profileStoreActiveSelector: what each action writes to the saved profile
 * list, and when it writes nothing. The real store and its persist wiring run;
 * only AsyncStorage is replaced, so its writes can be counted.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';

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

const PK = (n: number) => n.toString(16).padStart(64, '0');

function entry(accountIndex: number, extra: Partial<ProfileEntry> = {}): ProfileEntry {
  return { accountIndex, pubkey: PK(accountIndex), addedAt: 1, ...extra };
}

const profiles = () => useProfileStore.getState().profiles;
const profileWrites = () =>
  jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === 'profile-store').length;

beforeEach(() => {
  useProfileStore.setState({ activeAccountIndex: 0, profiles: [] });
  jest.mocked(AsyncStorage.setItem).mockClear();
});

describe('addProfile', () => {
  it('records an imported profile on external chain 1 when no chain is given', () => {
    expect(useProfileStore.getState().addProfile(123456, PK(9), 'imported')).toBe(true);
    expect(profiles()).toEqual([
      {
        accountIndex: 123456,
        pubkey: PK(9),
        addedAt: expect.any(Number),
        source: 'imported',
        externalChain: 1,
      },
    ]);
  });

  it('records a derived profile with no source and no chain fields', () => {
    useProfileStore.getState().addProfile(0, PK(0));
    expect(profiles()[0]).toEqual({ accountIndex: 0, pubkey: PK(0), addedAt: expect.any(Number) });
  });

  it('drops an explicit chain 0 but keeps an explicit chain of 1 or more', () => {
    useProfileStore.getState().addProfile(1, PK(1), 'derived', 0);
    useProfileStore.getState().addProfile(2, PK(2), 'imported', 3);
    expect(profiles()[0]).not.toHaveProperty('externalChain');
    expect(profiles()[0].source).toBe('derived');
    expect(profiles()[1].externalChain).toBe(3);
  });
});

describe('getNextAccountIndex', () => {
  it('starts at 0 and follows the highest derived index, ignoring imported ones', () => {
    expect(useProfileStore.getState().getNextAccountIndex()).toBe(0);
    useProfileStore.setState({
      profiles: [
        entry(0),
        entry(4),
        entry(2_000_000_000, { source: 'imported', externalChain: 1 }),
      ],
    });
    expect(useProfileStore.getState().getNextAccountIndex()).toBe(5);
  });

  it('is 0 when only imported profiles exist', () => {
    useProfileStore.setState({ profiles: [entry(77, { source: 'imported', externalChain: 1 })] });
    expect(useProfileStore.getState().getNextAccountIndex()).toBe(0);
  });
});

describe('switchProfile', () => {
  it('switches only to a listed profile and reports whether it did', () => {
    useProfileStore.setState({ profiles: [entry(0), entry(1)] });
    expect(useProfileStore.getState().switchProfile(5)).toBe(false);
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(useProfileStore.getState().switchProfile(1)).toBe(true);
    expect(useProfileStore.getState().activeAccountIndex).toBe(1);
  });
});

describe('repairDerivedSource', () => {
  it('turns an imported row back into a derived one on chain 0 only when the key matches', () => {
    useProfileStore.setState({ profiles: [entry(3, { source: 'imported', externalChain: 1 })] });
    expect(useProfileStore.getState().repairDerivedSource(3, PK(99))).toBe(false);
    expect(profiles()[0].source).toBe('imported');

    expect(useProfileStore.getState().repairDerivedSource(3, PK(3))).toBe(true);
    expect(profiles()[0]).toMatchObject({ source: 'derived', externalChain: 0 });
  });

  it('refuses a profile that is already derived', () => {
    useProfileStore.setState({ profiles: [entry(3)] });
    expect(useProfileStore.getState().repairDerivedSource(3, PK(3))).toBe(false);
  });
});

describe('updateProfileMetadata', () => {
  it('sets the cached name and picture on that profile only', () => {
    useProfileStore.setState({ profiles: [entry(0), entry(1)] });
    useProfileStore.getState().updateProfileMetadata(1, 'Alice', 'https://pic.example/a.png');
    expect(profiles()[1]).toMatchObject({
      cachedDisplayName: 'Alice',
      cachedPicture: 'https://pic.example/a.png',
    });
    expect(profiles()[0]).not.toHaveProperty('cachedDisplayName');
  });

  it('clears the cached name and picture when called without them', () => {
    useProfileStore.setState({
      profiles: [
        entry(0, { cachedDisplayName: 'Alice', cachedPicture: 'https://pic.example/a.png' }),
      ],
    });
    useProfileStore.getState().updateProfileMetadata(0);
    // QUIRK: a call with no name is a clear, not "leave as is", so a caller
    // that only knows the picture wipes the name. A later fix should change
    // this assertion on purpose.
    expect(profiles()[0].cachedDisplayName).toBeUndefined();
    expect(profiles()[0].cachedPicture).toBeUndefined();
  });

  it('clips a name longer than 512 characters and keeps one at the limit whole', () => {
    useProfileStore.setState({ profiles: [entry(0), entry(1)] });
    useProfileStore.getState().updateProfileMetadata(0, 'n'.repeat(513));
    useProfileStore.getState().updateProfileMetadata(1, 'm'.repeat(512));
    expect(profiles()[0].cachedDisplayName).toBe('n'.repeat(512));
    expect(profiles()[1].cachedDisplayName).toBe('m'.repeat(512));
  });

  it('does not save a picture URL longer than 2048 characters, and keeps one at the limit', () => {
    const url = (length: number) => `https://pic.example/${'p'.repeat(length - 20)}`;
    useProfileStore.setState({ profiles: [entry(0), entry(1)] });
    useProfileStore.getState().updateProfileMetadata(0, 'Alice', url(2049));
    useProfileStore.getState().updateProfileMetadata(1, 'Bob', url(2048));
    expect(profiles()[0]).toMatchObject({ cachedDisplayName: 'Alice', cachedPicture: undefined });
    expect(profiles()[1].cachedPicture).toBe(url(2048));
  });
});

describe('setWalletDatabaseCreated', () => {
  it('marks only the named profiles and saves once', () => {
    useProfileStore.setState({ profiles: [entry(0), entry(1), entry(2)] });
    jest.mocked(AsyncStorage.setItem).mockClear();

    useProfileStore.getState().setWalletDatabaseCreated([0, 2], true);
    expect(profiles().map((p) => p.walletDatabaseCreated)).toEqual([true, undefined, true]);
    expect(profileWrites()).toBe(1);
  });

  it('saves nothing when every named profile already has that value', () => {
    useProfileStore.setState({
      profiles: [entry(0, { walletDatabaseCreated: true }), entry(1)],
    });
    jest.mocked(AsyncStorage.setItem).mockClear();

    useProfileStore.getState().setWalletDatabaseCreated([0], true);
    useProfileStore.getState().setWalletDatabaseCreated([1], false);
    useProfileStore.getState().setWalletDatabaseCreated([42], true);
    expect(profileWrites()).toBe(0);
  });

  it('can clear the mark again', () => {
    useProfileStore.setState({ profiles: [entry(0, { walletDatabaseCreated: true })] });
    useProfileStore.getState().setWalletDatabaseCreated([0], false);
    expect(profiles()[0].walletDatabaseCreated).toBe(false);
  });
});

describe('hasPubkey', () => {
  it('says whether any profile holds that key', () => {
    useProfileStore.setState({ profiles: [entry(0)] });
    expect(useProfileStore.getState().hasPubkey(PK(0))).toBe(true);
    expect(useProfileStore.getState().hasPubkey(PK(1))).toBe(false);
  });
});
