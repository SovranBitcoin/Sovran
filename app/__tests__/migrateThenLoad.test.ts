/**
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * What the migration gate leaves in the stores the app gate reads next.
 *
 * The settings and wallet lifecycle stores load when their modules are
 * evaluated, which is before a migration runs. A lifecycle stamp written
 * afterwards is on disk only: the gate below would see `seedCreatedAt: null`,
 * take a long-standing wallet for a reinstall, and its save would replace the
 * stamp. These run the real stores and migrations over in-memory storage, in
 * that order.
 */
import { PHRASE } from './releaseFixtures/format';

const mockAsync = new Map<string, string>();
const mockSecure = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockAsync.set(key, value),
    removeItem: async (key: string) => void mockAsync.delete(key),
    getAllKeys: async () => [...mockAsync.keys()],
  };
  return { __esModule: true, default: storage, ...storage };
});
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock('@/shared/lib/loggerFile', () => ({
  applyFileLogging: () => {},
  exportLogFile: async () => null,
  clearLogFile: () => {},
  getLogFileInfo: () => null,
}));

// The first cold start compiles the store graph.
jest.setTimeout(60_000);

async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** A cold start through the migration gate: store modules first, as in the bundle. */
async function coldStart() {
  jest.resetModules();
  // The setup file patches expo-asset for bundled images; a fresh registry needs it again.
  require('../jest.staticAssets.js');
  const { useSettingsStore } =
    require('@/shared/stores/global/settingsStore') as typeof import('@/shared/stores/global/settingsStore');
  const { useWalletLifecycleStore } =
    require('@/shared/stores/global/walletLifecycleStore') as typeof import('@/shared/stores/global/walletLifecycleStore');
  const { migrateThenLoad } =
    require('@/shared/lib/migrations/migrateThenLoad') as typeof import('@/shared/lib/migrations/migrateThenLoad');
  // Both stores finish their first load before any migration starts.
  await settle();
  await migrateThenLoad();
  return { settings: useSettingsStore, lifecycle: useWalletLifecycleStore };
}

const savedLifecycle = () =>
  (JSON.parse(mockAsync.get('wallet-lifecycle')!) as { state: Record<string, unknown> }).state;

beforeEach(() => {
  mockAsync.clear();
  mockSecure.clear();
  for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  [
    '0.0.61, before the onboarding flag',
    // stores/settingsStore.ts:386@a838d5bc3
    { termsAccepted: { termsAccepted: true, date: '2025-03-02T10:00:00.000Z' }, language: 'en' },
  ],
  [
    '0.0.62, before the wallet lifecycle record',
    // shared/stores/global/settingsStore.ts:324@19388f0e3
    {
      termsAccepted: { termsAccepted: true, date: '2025-03-02T10:00:00.000Z' },
      hasSeenOnboarding: true,
    },
  ],
])('a wallet upgraded from %s', (_release, settingsState) => {
  beforeEach(() => {
    mockSecure.set('user_mnemonic', PHRASE);
    mockAsync.set('settings-store', JSON.stringify({ state: settingsState, version: 0 }));
  });

  it('reaches the app gate as onboarded, with a seed this install made', async () => {
    const { settings, lifecycle } = await coldStart();

    expect(settings.getState().hasSeenOnboarding).toBe(true);
    expect(typeof lifecycle.getState().seedCreatedAt).toBe('number');
    expect(lifecycle.getState().restoreStatus).toBe('not-needed');
  });

  it('keeps the stamp through the next save and the next launch', async () => {
    const first = await coldStart();
    const stampedAt = first.lifecycle.getState().seedCreatedAt;

    first.lifecycle.getState().markRecoveryPhraseVerified();
    await settle();
    expect(savedLifecycle()).toMatchObject({
      seedCreatedAt: stampedAt,
      restoreStatus: 'not-needed',
    });

    const second = await coldStart();
    expect(second.lifecycle.getState().seedCreatedAt).toBe(stampedAt);
    expect(second.settings.getState().hasSeenOnboarding).toBe(true);
  });
});

describe('a reinstall: the keychain survived and storage is empty', () => {
  beforeEach(() => void mockSecure.set('user_mnemonic', PHRASE));

  it('is not stamped, on the first launch or the one after', async () => {
    for (let launch = 0; launch < 2; launch++) {
      const { settings, lifecycle } = await coldStart();

      expect(settings.getState().hasSeenOnboarding).toBe(false);
      expect(lifecycle.getState().seedCreatedAt).toBeNull();
      expect(lifecycle.getState().restoreStatus).toBe('unknown');
      expect(mockAsync.has('wallet-lifecycle')).toBe(false);

      // The terms are accepted on the first launch, before the restore is offered.
      settings.getState().acceptLegalDocuments();
      await settle();
    }
  });
});
