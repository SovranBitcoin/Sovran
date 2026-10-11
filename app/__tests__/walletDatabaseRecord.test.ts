/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import {
  askForRestoreIfWalletDatabaseLost,
  forgetWalletDatabases,
  recordWalletDatabaseCreated,
} from '@/shared/lib/cashu/walletDatabaseRecord';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/shared/lib/logger', () => {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { log, storeLog: log, cashuLog: log, redactError: () => 'redacted' };
});

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const status = () => useWalletLifecycleStore.getState().restoreStatus;
const recorded = () =>
  useProfileStore
    .getState()
    .profiles.filter((p) => p.walletDatabaseCreated === true)
    .map((p) => p.accountIndex);
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** The profile list and restore record as 0.1.3 saved them, on a wallet in use. */
const released = {
  profiles: {
    state: {
      activeAccountIndex: 0,
      profiles: [
        { accountIndex: 0, pubkey: A, addedAt: 1, cachedBalanceSats: 42 },
        { accountIndex: 1, pubkey: B, addedAt: 2, source: 'imported', externalChain: 1 },
      ],
    },
    version: 2,
  },
  lifecycle: {
    state: {
      seedCreatedAt: 5,
      recoveryPhraseVerifiedAt: null,
      recoveryPhraseVerifiedRevision: null,
      restoreStatus: 'complete',
      lastRestoreAt: 6,
      lastRestoreError: null,
    },
    version: 0,
  },
};

async function startWith(saved: { profiles?: object; lifecycle?: object }) {
  // Reset first: a reset saves the defaults, which must not replace what follows.
  useProfileStore.setState(useProfileStore.getInitialState(), true);
  useWalletLifecycleStore.setState(useWalletLifecycleStore.getInitialState(), true);
  await flush();
  await AsyncStorage.clear();
  if (saved.profiles) await AsyncStorage.setItem('profile-store', JSON.stringify(saved.profiles));
  if (saved.lifecycle)
    await AsyncStorage.setItem('wallet-lifecycle', JSON.stringify(saved.lifecycle));
  await useProfileStore.persist.rehydrate();
  await useWalletLifecycleStore.persist.rehydrate();
}

describe('an install upgrading from 0.1.3', () => {
  beforeEach(() => startWith(released));

  it('loads the saved profile list exactly as it was written', () => {
    expect(useProfileStore.getState().profiles).toEqual(released.profiles.state.profiles);
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    const schema = persistRegistry.find((entry) => entry.name === 'profile-store')!.schema;
    expect(schema.parse(released.profiles.state)).toEqual(released.profiles.state);
  });

  it('records the account it opens on its first launch and asks for nothing', () => {
    // Account 0 opens with its tables in place. Account 1 is not opened, so
    // it is not recorded until it is.
    askForRestoreIfWalletDatabaseLost(0, false);
    recordWalletDatabaseCreated(0);

    expect(status()).toBe('complete');
    expect(recorded()).toEqual([0]);
  });

  it('asks for nothing when an account it never opened comes up empty', () => {
    // Nothing says this install ever opened it, so there is nothing to compare with.
    recordWalletDatabaseCreated(0);
    askForRestoreIfWalletDatabaseLost(1, true);
    expect(status()).toBe('complete');
  });

  it('saves the record in a form the next launch reads back', async () => {
    recordWalletDatabaseCreated(0);
    await flush();
    const saved = JSON.parse((await AsyncStorage.getItem('profile-store'))!);
    const schema = persistRegistry.find((entry) => entry.name === 'profile-store')!.schema;
    const loaded = schema.parse(saved.state) as { profiles: { walletDatabaseCreated?: boolean }[] };
    expect(loaded.profiles.map((p) => p.walletDatabaseCreated)).toEqual([true, undefined]);
  });
});

describe('a recorded account whose database comes up empty', () => {
  beforeEach(async () => {
    await startWith(released);
    recordWalletDatabaseCreated(0);
    recordWalletDatabaseCreated(1);
  });

  it.each(['complete', 'not-needed', 'unknown', 'in-progress'] as const)(
    'asks for a restore when the status was %s',
    (before) => {
      useWalletLifecycleStore.getState().setRestoreStatus(before);
      askForRestoreIfWalletDatabaseLost(1, true);
      expect(status()).toBe('pending');
    }
  );

  it('leaves a failed restore showing its error', () => {
    useWalletLifecycleStore.getState().setRestoreStatus('failed', 'mint unreachable');
    askForRestoreIfWalletDatabaseLost(1, true);
    expect(status()).toBe('failed');
    expect(useWalletLifecycleStore.getState().lastRestoreError).toBe('mint unreachable');
  });

  it('saves the request, so it survives the app being closed before the restore', async () => {
    askForRestoreIfWalletDatabaseLost(0, true);
    await flush();
    expect(JSON.parse((await AsyncStorage.getItem('wallet-lifecycle'))!).state.restoreStatus).toBe(
      'pending'
    );
  });

  it('asks nothing while the database still has its tables', () => {
    askForRestoreIfWalletDatabaseLost(1, false);
    expect(status()).toBe('complete');
  });

  it('asks after the saved status has loaded, not before it', async () => {
    await AsyncStorage.setItem('wallet-lifecycle', JSON.stringify(released.lifecycle));
    const hasHydrated = jest
      .spyOn(useWalletLifecycleStore.persist, 'hasHydrated')
      .mockReturnValue(false);
    askForRestoreIfWalletDatabaseLost(1, true);
    hasHydrated.mockRestore();
    // Loading the saved `complete` now must not be the last word.
    await useWalletLifecycleStore.persist.rehydrate();
    expect(status()).toBe('pending');
  });
});

describe('an account with no record', () => {
  it('opens its first database on a fresh install without a restore', async () => {
    await startWith({});
    useProfileStore.getState().addProfile(0, A);
    askForRestoreIfWalletDatabaseLost(0, true);
    recordWalletDatabaseCreated(0);

    expect(status()).toBe('unknown');
    expect(recorded()).toEqual([0]);
  });

  it('opens a newly added account without a restore', async () => {
    await startWith(released);
    recordWalletDatabaseCreated(0);
    recordWalletDatabaseCreated(1);
    useProfileStore.getState().addProfile(2, 'c'.repeat(64));

    askForRestoreIfWalletDatabaseLost(2, true);
    expect(status()).toBe('complete');
    expect(recorded()).toEqual([0, 1]);
  });

  it('does nothing for an account that is not in the list', async () => {
    await startWith(released);
    askForRestoreIfWalletDatabaseLost(7, true);
    recordWalletDatabaseCreated(7);
    expect(status()).toBe('complete');
    expect(useProfileStore.getState().profiles).toEqual(released.profiles.state.profiles);
  });
});

describe('forgetting', () => {
  beforeEach(async () => {
    await startWith(released);
    recordWalletDatabaseCreated(0);
    recordWalletDatabaseCreated(1);
  });

  it('lets an account that was deleted on purpose open empty', async () => {
    await forgetWalletDatabases([1]);
    askForRestoreIfWalletDatabaseLost(1, true);
    expect(status()).toBe('complete');
    expect(recorded()).toEqual([0]);
  });

  it('resolves only once the list on disk has forgotten the account', async () => {
    await flush();
    expect(
      JSON.parse((await AsyncStorage.getItem('profile-store'))!).state.profiles[1]
    ).toMatchObject({
      walletDatabaseCreated: true,
    });

    await forgetWalletDatabases([1]);

    const saved = JSON.parse((await AsyncStorage.getItem('profile-store'))!).state.profiles;
    expect(saved[1].walletDatabaseCreated).not.toBe(true);
    expect(saved[0].walletDatabaseCreated).toBe(true);
  });

  it('rejects when the save is dropped, so the caller deletes nothing', async () => {
    await flush();
    // A save that reports success and stores nothing.
    const real = AsyncStorage.setItem;
    AsyncStorage.setItem = async () => undefined;
    try {
      await expect(forgetWalletDatabases([1], 100)).rejects.toThrow('could not be saved');
    } finally {
      AsyncStorage.setItem = real;
    }

    // Trying again saves it, though memory already said forgotten.
    await forgetWalletDatabases([1], 500);
    const saved = JSON.parse((await AsyncStorage.getItem('profile-store'))!).state.profiles;
    expect(saved[1].walletDatabaseCreated).not.toBe(true);
  });

  it('rejects when the saved list cannot be read back in time', async () => {
    await flush();
    const real = AsyncStorage.getItem;
    AsyncStorage.getItem = () => new Promise(() => undefined);
    try {
      await expect(forgetWalletDatabases([1], 100)).rejects.toThrow('could not be saved');
    } finally {
      AsyncStorage.getItem = real;
    }
  });

  it('does not carry over to an account added again at the same index', () => {
    useProfileStore.setState((state) => ({
      profiles: state.profiles.filter((p) => p.accountIndex !== 1),
    }));
    useProfileStore.getState().addProfile(1, B, 'imported');
    askForRestoreIfWalletDatabaseLost(1, true);
    expect(status()).toBe('complete');
  });

  it('reads an unreadable saved value as not recorded and keeps the rest of the list', () => {
    const schema = persistRegistry.find((entry) => entry.name === 'profile-store')!.schema;
    const parsed = schema.parse({
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 0, pubkey: A, addedAt: 1, walletDatabaseCreated: 'yes' }],
    }) as { profiles: { walletDatabaseCreated?: boolean; pubkey: string }[] };
    expect(parsed.profiles[0].pubkey).toBe(A);
    expect(parsed.profiles[0].walletDatabaseCreated).toBeUndefined();
  });
});
