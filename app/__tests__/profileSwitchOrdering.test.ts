/**
 * BTC-13 regression: the profile switch must persist the target and restart
 * WITHOUT flipping the in-memory store first. The in-memory flip drives
 * RootLayout's keyed remount — flipping before restart double-boots the new
 * profile in-process (coco init, SQLite migrations, PBKDF2) racing the
 * native restart. The in-memory flip is allowed only as the failed-restart
 * fallback.
 */
import AsyncStorageMock from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/shared/lib/profile/appRestart', () => ({
  restartApp: jest.fn(),
}));

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    cleanup: jest.fn().mockResolvedValue(undefined),
    isReadyForCleanup: jest.fn(() => true),
    isInitialized: jest.fn(() => true),
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
    mockRestart.mockResolvedValue(true);

    const ok = await switchToExistingProfile({ accountIndex: 1 });

    expect(ok).toBe(true);
    // The restart boots from the persisted target…
    expect(persistedActiveIndex(AsyncStorage)).toBe(1);
    // …but the in-memory store was never flipped — no remount, no
    // in-process double boot racing the restart.
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
  });

  it('flips the in-memory store only when the restart fails (fallback boot)', async () => {
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockResolvedValue(false);

    const ok = await switchToExistingProfile({ accountIndex: 1 });

    expect(ok).toBe(true);
    expect(persistedActiveIndex(AsyncStorage)).toBe(1);
    expect(useProfileStore.getState().activeAccountIndex).toBe(1);
  });

  it('refuses an unknown target without touching anything', async () => {
    const { switchToExistingProfile, useProfileStore, mockRestart, AsyncStorage } = setup();
    mockRestart.mockResolvedValue(true);

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
    jest.mocked(restartApp).mockResolvedValue(true);

    const pending = orchestrator.switchToExistingProfile({ accountIndex: 1 });
    // Let the pre-cleanup awaits settle, then push past the 5s timeout.
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toBe(true);
    expect(jest.mocked(restartApp)).toHaveBeenCalled();
  });
});
