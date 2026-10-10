/**
 * BTC-13 regression: the profile switch must persist the target and restart
 * WITHOUT flipping the in-memory store first. The in-memory flip drives
 * RootLayout's keyed remount — flipping before restart double-boots the new
 * profile in-process (coco init, SQLite migrations, PBKDF2) racing the
 * native restart. If the restart itself fails, the app is held down until it
 * is reopened; the account is never flipped in memory on this path.
 */
import AsyncStorageMock from '@react-native-async-storage/async-storage';

// A literal, identical in every module graph, so it does not need re-requiring
// after `jest.resetModules()` the way the stateful modules below do.
import { MAX_PROFILES } from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/shared/lib/profile/appRestart', () => ({
  restartApp: jest.fn(),
}));

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    cleanup: jest.fn().mockResolvedValue(undefined),
    completeReset: jest.fn().mockResolvedValue(undefined),
    isReadyForCleanup: jest.fn(() => true),
    isInitialized: jest.fn(() => true),
    getCleanupReadiness: jest.fn(() => ({ ready: true })),
  },
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { log: noop, storeLog: noop, redactError: (e: unknown) => String(e) };
});

jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: { getState: () => ({ setActive: jest.fn() }) },
}));

jest.mock('@/shared/stores/runtime/popupStore', () => ({
  usePopupStore: { getState: () => ({ destroySheet: jest.fn(), close: jest.fn() }) },
}));

// The orchestrator holds module-level transition state
// (transitionInFlight stays true after a successful restart by design), so
// every test gets a fresh module graph — and the fresh AsyncStorage mock
// instance must be read from the same graph (the top-level import is the
// stale instance after jest.resetModules()).
function setup() {
  jest.resetModules();
  jest.clearAllMocks();
  const AsyncStorage =
    require('@react-native-async-storage/async-storage') as typeof AsyncStorageMock;
  const orchestrator =
    require('@/shared/lib/profile/profileSessionOrchestrator') as typeof import('@/shared/lib/profile/profileSessionOrchestrator');
  const { useProfileStore } =
    require('@/shared/stores/global/profileStore') as typeof import('@/shared/stores/global/profileStore');
  const { restartApp } =
    require('@/shared/lib/profile/appRestart') as typeof import('@/shared/lib/profile/appRestart');
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [
      { accountIndex: 0, pubkey: 'a'.repeat(64), addedAt: 1 },
      { accountIndex: 1, pubkey: 'b'.repeat(64), addedAt: 2 },
    ],
  });
  (AsyncStorage.setItem as jest.Mock).mockClear();
  return {
    switchToExistingProfile: orchestrator.switchToExistingProfile,
    createAndSwitchProfile: orchestrator.createAndSwitchProfile,
    deleteAllProfiles: orchestrator.deleteAllProfiles,
    recoverMnemonicSession: orchestrator.recoverMnemonicSession,
    importAndSwitchProfile: orchestrator.importAndSwitchProfile,
    useProfileStore,
    mockRestart: jest.mocked(restartApp),
    AsyncStorage,
  };
}

function persistedActiveIndex(AsyncStorage: typeof AsyncStorageMock): number | undefined {
  const writes = (AsyncStorage.setItem as jest.Mock).mock.calls.filter(
    ([key]) => key === 'profile-store'
  );
  if (writes.length === 0) return undefined;
  const last = writes[writes.length - 1][1];
  return JSON.parse(last).state.activeAccountIndex;
}

describe('switchToExistingProfile — persist-before-restart (BTC-13)', () => {
  it('persists the target and restarts without flipping the in-memory store', async () => {
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(true);

    const ok = await switchToExistingProfile({ accountIndex: 1 });

    expect(ok).toBe(true);
    // The restart boots from the persisted target…
    expect(persistedActiveIndex(AsyncStorage)).toBe(1);
    // …but the in-memory store was never flipped — no remount, no
    // in-process double boot racing the restart.
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
  });

  it('holds the app and never flips the account in memory when the restart fails', async () => {
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(false);
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const ok = await switchToExistingProfile({ accountIndex: 1 });

    expect(ok).toBe(true);
    // The target is on disk, so reopening the app boots into it…
    expect(persistedActiveIndex(AsyncStorage)).toBe(1);
    // …but this runtime stays on the old account: a flip would remount the
    // providers over stores still holding the old account's state.
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(alert).toHaveBeenCalledWith('Restart Required', expect.any(String), expect.any(Array));
    // The lock stays held, so nothing else can run until the reopen.
    expect(await switchToExistingProfile({ accountIndex: 0 })).toBe(false);
  });

  it('holds the app when the target cannot be recorded after the wallet was closed', async () => {
    // The wallet is already closed, so carrying on as the old account is not
    // an option: releasing here used to leave it running with no wallet.
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(true);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'profile-store') throw new Error('disk full');
    });
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(false);

    expect(mockRestart).not.toHaveBeenCalled();
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(alert).toHaveBeenCalledWith(
      'Restart Required',
      expect.stringContaining('Could not switch'),
      expect.any(Array)
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async () => undefined);
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(false);
  });

  it('holds the app when the restart call throws', async () => {
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockImplementation(() => {
      throw new Error('reload unavailable');
    });
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    // The target was recorded, so reopening finishes the switch.
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);

    expect(persistedActiveIndex(AsyncStorage)).toBe(1);
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(alert).toHaveBeenCalledWith(
      'Restart Required',
      expect.stringContaining('finish switching'),
      expect.any(Array)
    );
    mockRestart.mockReturnValue(true);
    expect(await switchToExistingProfile({ accountIndex: 0 })).toBe(false);
  });

  it('refuses an unknown target without touching anything', async () => {
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(true);

    const ok = await switchToExistingProfile({ accountIndex: 9 });

    expect(ok).toBe(false);
    expect(persistedActiveIndex(AsyncStorage)).toBeUndefined();
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(mockRestart).not.toHaveBeenCalled();
  });
});

describe('switchToExistingProfile — bounded teardown (BTC-14)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a hung coco cleanup does not pin the switch — restart proceeds', async () => {
    jest.resetModules();
    jest.clearAllMocks();
    const { CocoManager } = require('@/shared/lib/cashu/manager') as {
      CocoManager: Record<string, jest.Mock>;
    };
    // The NPC plugin's shutdown awaits in-flight sync forever — simulate.
    CocoManager.cleanup.mockReturnValue(new Promise(() => {}));
    CocoManager.isReadyForCleanup.mockReturnValue(true);

    const orchestrator =
      require('@/shared/lib/profile/profileSessionOrchestrator') as typeof import('@/shared/lib/profile/profileSessionOrchestrator');
    const { useProfileStore } =
      require('@/shared/stores/global/profileStore') as typeof import('@/shared/stores/global/profileStore');
    const { restartApp } =
      require('@/shared/lib/profile/appRestart') as typeof import('@/shared/lib/profile/appRestart');
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: [
        { accountIndex: 0, pubkey: 'a'.repeat(64), addedAt: 1 },
        { accountIndex: 1, pubkey: 'b'.repeat(64), addedAt: 2 },
      ],
    });
    jest.mocked(restartApp).mockReturnValue(true);

    const pending = orchestrator.switchToExistingProfile({ accountIndex: 1 });
    // Let the pre-cleanup awaits settle, then push past the 5s timeout.
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toBe(true);
    expect(jest.mocked(restartApp)).toHaveBeenCalled();
  });
});

describe('createAndSwitchProfile — capacity', () => {
  // `PersistedProfileStore` caps `profiles`, and `addProfile` used to append
  // past it: the blob then failed parse and the next launch discarded the
  // GLOBAL profile store. Refusing is only half the fix — the orchestrator
  // switches into the index it just asked for, so a refusal it ignored would
  // leave the app running as an account the store does not hold.
  it('aborts instead of switching into a profile the store refused', async () => {
    const { createAndSwitchProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(true);
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: Array.from({ length: MAX_PROFILES }, (_, i) => ({
        accountIndex: i,
        pubkey: `${i}`.padStart(64, '0'),
        addedAt: i + 1,
      })),
    });
    (AsyncStorage.setItem as jest.Mock).mockClear();

    const resetStages = jest.fn();
    const cancelResetStages = jest.fn();
    const created = await createAndSwitchProfile({
      getKeysForAccount: async () => ({ pubkey: 'f'.repeat(64), privateKey: new Uint8Array() }),
      resetStages,
      cancelResetStages,
    });

    expect(created).toBe(false);
    // The bail happens after the stages were held, so releasing them is part
    // of the unwind — otherwise the boot gate stays up over a switch that is
    // not happening.
    expect(resetStages).toHaveBeenCalledTimes(1);
    expect(cancelResetStages).toHaveBeenCalled();
    // Nothing was switched to, nothing was persisted, nothing restarted.
    expect(useProfileStore.getState().profiles).toHaveLength(MAX_PROFILES);
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(persistedActiveIndex(AsyncStorage)).toBeUndefined();
    expect(mockRestart).not.toHaveBeenCalled();
  });

  it('leaves the transition guard clear so a later switch still works', async () => {
    // Every other bail in `createAndSwitchProfile` unwinds fully
    // (`cancelResetStages` + `transitionInFlight = false` + `endTransition`).
    // A bail that only cancels the stages leaves the module-level guard set,
    // and the guard is the first thing every switch checks — so one failed
    // create would refuse every profile switch for the rest of the session.
    const { createAndSwitchProfile, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(true);
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: Array.from({ length: MAX_PROFILES }, (_, i) => ({
        accountIndex: i,
        pubkey: `${i}`.padStart(64, '0'),
        addedAt: i + 1,
      })),
    });

    expect(
      await createAndSwitchProfile({
        getKeysForAccount: async () => ({ pubkey: 'f'.repeat(64), privateKey: new Uint8Array() }),
      })
    ).toBe(false);

    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });

  it('leaves the guard clear when key derivation fails too', async () => {
    const { createAndSwitchProfile, switchToExistingProfile, mockRestart } = setup();
    mockRestart.mockReturnValue(true);

    expect(
      await createAndSwitchProfile({
        getKeysForAccount: async () => null,
      })
    ).toBe(false);

    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });

  it('holds the app when the new profile cannot be made active on disk', async () => {
    const { createAndSwitchProfile, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(true);
    const { profilePersistWritesBlocked } =
      require('@/shared/lib/persist/profileWriteBarrier') as typeof import('@/shared/lib/persist/profileWriteBarrier');
    const AsyncStorage =
      require('@react-native-async-storage/async-storage') as typeof AsyncStorageMock;
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // The row is added and saved; the write that makes it the active account fails.
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      if (key === 'profile-store' && JSON.parse(value).state.activeAccountIndex === 2)
        throw new Error('disk full');
    });

    const created = await createAndSwitchProfile({
      getKeysForAccount: async () => ({ pubkey: 'f'.repeat(64), privateKey: new Uint8Array() }),
    });

    expect(created).toBe(false);
    expect(mockRestart).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    // Held: the old account stays the one in memory, per-profile saves are
    // blocked, and nothing else can start.
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(profilePersistWritesBlocked()).toBe(true);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async () => undefined);
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(false);
  });

  it('creates and switches normally when there is room', async () => {
    const { createAndSwitchProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(true);
    (AsyncStorage.setItem as jest.Mock).mockClear();

    const created = await createAndSwitchProfile({
      getKeysForAccount: async () => ({ pubkey: 'f'.repeat(64), privateKey: new Uint8Array() }),
    });

    expect(created).toBe(true);
    expect(useProfileStore.getState().profiles).toHaveLength(3);
    expect(persistedActiveIndex(AsyncStorage)).toBe(2);
  });
});

describe('deleteAllProfiles — a wipe that does not finish', () => {
  function mockSecureReset(prepare: () => Promise<() => Promise<boolean>>) {
    jest.doMock('@/shared/lib/nostr/secureStorage', () => ({
      ...jest.requireActual('@/shared/lib/nostr/secureStorage'),
      prepareSecureDataReset: jest.fn(prepare),
    }));
  }

  afterEach(() => jest.dontMock('@/shared/lib/nostr/secureStorage'));

  it('gives the app back when it fails before anything is erased', async () => {
    mockSecureReset(async () => {
      throw new Error('keychain unavailable');
    });
    const { deleteAllProfiles, switchToExistingProfile, mockRestart } = setup();
    mockRestart.mockReturnValue(true);
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    expect(await deleteAllProfiles()).toBe(false);

    expect(alert).not.toHaveBeenCalled();
    // Nothing was erased, so the lock is released and the app carries on.
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });

  it('holds the app once erasing has started', async () => {
    mockSecureReset(async () => async () => false);
    const {
      deleteAllProfiles,
      switchToExistingProfile,
      useProfileStore,
      mockRestart,
      AsyncStorage,
    } = setup();
    mockRestart.mockReturnValue(true);
    const clear = jest.spyOn(AsyncStorage, 'clear');
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    // The wallet databases are gone and secure storage did not clear.
    expect(await deleteAllProfiles()).toBe(false);

    // Preferences are not erased and the app is not restarted into a wallet
    // whose keys are still there but whose databases are not.
    expect(clear).not.toHaveBeenCalled();
    expect(mockRestart).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Restart Required', expect.any(String), expect.any(Array));
    // The profiles are still listed, and nothing may run as them over a
    // deleted wallet: the lock stays held until the app is reopened.
    expect(useProfileStore.getState().profiles).toHaveLength(2);
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(false);
  });

  it('holds the app when the wipe finishes but the restart does not happen', async () => {
    mockSecureReset(async () => async () => true);
    const { deleteAllProfiles, switchToExistingProfile, mockRestart } = setup();
    mockRestart.mockReturnValue(false);
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    expect(await deleteAllProfiles()).toBe(true);

    expect(alert).toHaveBeenCalledWith('Restart Required', expect.any(String), expect.any(Array));
    expect(await switchToExistingProfile({ accountIndex: 0 })).toBe(false);
  });
});

describe('waits made while the lock is held are bounded', () => {
  // The lock is one per runtime. A promise that never settles would keep it,
  // and every other account flow would be refused until the app restarted.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives up on a key derivation that never settles and frees the lock', async () => {
    const { createAndSwitchProfile, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(true);

    const pending = createAndSwitchProfile({ getKeysForAccount: () => new Promise(() => {}) });
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(31_000);

    await expect(pending).resolves.toBe(false);
    expect(useProfileStore.getState().profiles).toHaveLength(2);
    expect(mockRestart).not.toHaveBeenCalled();
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });

  it('holds the app when the write of the target never answers', async () => {
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(true);
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string) =>
      key === 'profile-store' ? new Promise(() => {}) : Promise.resolve()
    );
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const pending = switchToExistingProfile({ accountIndex: 1 });
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(11_000);

    // It ends, instead of waiting for good with the lock held and no message.
    await expect(pending).resolves.toBe(false);
    expect(mockRestart).not.toHaveBeenCalled();
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(alert).toHaveBeenCalled();
  });

  it('still lets a flow start when the disk guard never answers', async () => {
    const { switchToExistingProfile, mockRestart, AsyncStorage } = setup();
    mockRestart.mockReturnValue(true);
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
      key === 'profile-transition-in-progress' ? new Promise(() => {}) : Promise.resolve(null)
    );

    const pending = switchToExistingProfile({ accountIndex: 1 });
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(6_000);
    await jest.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toBe(true);
    expect(mockRestart).toHaveBeenCalled();
  });

  it('refuses a recovery when the wallet does not close, and frees the lock', async () => {
    const { recoverMnemonicSession, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(true);
    const { CocoManager } = require('@/shared/lib/cashu/manager') as {
      CocoManager: Record<string, jest.Mock>;
    };
    CocoManager.cleanup.mockReturnValue(new Promise(() => {}));
    const profiles = useProfileStore.getState().profiles;
    useProfileStore.setState({ profiles: [] });

    const pending = recoverMnemonicSession('abandon '.repeat(11) + 'about');
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(11_000);

    // The phrase is not replaced under a wallet that may still be writing.
    await expect(pending).resolves.toBe(false);
    expect(CocoManager.cleanup).toHaveBeenCalled();
    expect(mockRestart).not.toHaveBeenCalled();
    useProfileStore.setState({ profiles });
    CocoManager.cleanup.mockResolvedValue(undefined);
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });
});

describe('importAndSwitchProfile', () => {
  const imported = { accountIndex: 77, pubkeyHex: 'c'.repeat(64), nsec: 'nsec1example' };
  const storeImportedNsec = jest.fn();

  beforeEach(() => {
    storeImportedNsec.mockReset().mockResolvedValue(true);
    jest.doMock('@/shared/lib/nostr/secureStorage', () => ({
      ...jest.requireActual('@/shared/lib/nostr/secureStorage'),
      storeImportedNsec,
    }));
  });
  afterEach(() => jest.dontMock('@/shared/lib/nostr/secureStorage'));

  it('stores the key, adds the profile and restarts into it, all under the lock', async () => {
    const {
      importAndSwitchProfile,
      switchToExistingProfile,
      useProfileStore,
      mockRestart,
      AsyncStorage,
    } = setup();
    mockRestart.mockReturnValue(true);

    expect(await importAndSwitchProfile(imported)).toBe('switching');

    expect(storeImportedNsec).toHaveBeenCalledWith(imported.pubkeyHex, imported.nsec);
    const added = useProfileStore.getState().profiles.find((p) => p.accountIndex === 77);
    expect(added).toMatchObject({ pubkey: imported.pubkeyHex, source: 'imported' });
    expect(persistedActiveIndex(AsyncStorage)).toBe(77);
    // Not flipped in memory, and the lock is kept for the restart.
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(false);
  });

  it('refuses an identity that is already a profile, without storing anything', async () => {
    const { importAndSwitchProfile, switchToExistingProfile, mockRestart } = setup();
    mockRestart.mockReturnValue(true);

    expect(await importAndSwitchProfile({ ...imported, pubkeyHex: 'b'.repeat(64) })).toBe('exists');

    expect(storeImportedNsec).not.toHaveBeenCalled();
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });

  it('does not store the key while another account flow is running', async () => {
    // It used to store the key and add the row first, and only then find out.
    const { importAndSwitchProfile, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(true);
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);

    expect(await importAndSwitchProfile(imported)).toBe('busy');

    expect(storeImportedNsec).not.toHaveBeenCalled();
    expect(useProfileStore.getState().profiles).toHaveLength(2);
  });

  it('gives the app back when secure storage refuses the key', async () => {
    storeImportedNsec.mockResolvedValue(false);
    const { importAndSwitchProfile, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(true);

    expect(await importAndSwitchProfile(imported)).toBe('key-not-stored');

    expect(useProfileStore.getState().profiles).toHaveLength(2);
    expect(mockRestart).not.toHaveBeenCalled();
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });

  it('gives the app back when the profile list is full', async () => {
    const { importAndSwitchProfile, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(true);
    useProfileStore.setState({
      profiles: Array.from({ length: MAX_PROFILES }, (_, i) => ({
        accountIndex: i,
        pubkey: `${i}`.padStart(64, '0'),
        addedAt: i + 1,
      })),
    });

    expect(await importAndSwitchProfile(imported)).toBe('limit');

    expect(mockRestart).not.toHaveBeenCalled();
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(true);
  });
});

describe('recoverMnemonicSession once the phrase is replaced', () => {
  beforeEach(() => {
    jest.doMock('@/shared/lib/nostr/secureStorage', () => ({
      ...jest.requireActual('@/shared/lib/nostr/secureStorage'),
      storeMnemonic: jest.fn(async () => true),
    }));
  });
  afterEach(() => jest.dontMock('@/shared/lib/nostr/secureStorage'));

  it('holds the app when the restart does not happen', async () => {
    // This runtime still holds keys from the old phrase. Giving the app back
    // would run the old identity over the new phrase.
    const { recoverMnemonicSession, switchToExistingProfile, useProfileStore, mockRestart } =
      setup();
    mockRestart.mockReturnValue(false);
    useProfileStore.setState({ profiles: [] });
    const { Alert } = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    expect(await recoverMnemonicSession('abandon '.repeat(11) + 'about')).toBe(true);

    expect(alert).toHaveBeenCalledWith(
      'Restart Required',
      expect.stringContaining('recovery phrase is saved'),
      expect.any(Array)
    );
    mockRestart.mockReturnValue(true);
    expect(await switchToExistingProfile({ accountIndex: 1 })).toBe(false);
  });
});
