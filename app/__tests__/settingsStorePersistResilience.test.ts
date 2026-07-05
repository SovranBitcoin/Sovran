/**
 * Regression test for the persist data-loss footgun: `createMergeWithSchema`
 * runs ONE parse over the whole settings blob and, before the fix, discarded
 * the ENTIRE blob if any single field failed — so a renamed `balanceSplitVariant`
 * value ('hero-minimal' → 'list') silently wiped `termsAccepted`, re-showing the
 * terms gate on every launch (seen on Android, branch feat/balance-split-variants).
 *
 * The fix gives every constrained field `.default(D).catch(D)` so a stale value
 * degrades to its default instead of failing the parse. This test loads a
 * persisted blob carrying BOTH a stale enum value and a load-bearing
 * `termsAccepted: true`, and asserts terms survive rehydrate.
 */

const mockMemory: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockMemory[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockMemory[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockMemory[k];
    },
  },
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  applyFileLogging: jest.fn(),
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/stores/runtime/mockDataStore', () => ({
  useMockDataStore: { getState: () => ({ activate: jest.fn(), deactivate: jest.fn() }) },
  purgeFixtureMetadata: jest.fn(),
}));

const STORAGE_KEY = 'settings-store';

function preload(state: Record<string, unknown>) {
  mockMemory[STORAGE_KEY] = JSON.stringify({ state, version: 3 });
}

async function loadStore() {
  const mod =
    require('@/shared/stores/global/settingsStore') as typeof import('@/shared/stores/global/settingsStore');
  await mod.useSettingsStore.persist.rehydrate();
  return mod.useSettingsStore;
}

describe('settingsStore persist resilience', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockMemory)) delete mockMemory[k];
  });

  it('keeps terms acceptance when a removed persisted field is still in the blob', async () => {
    // `balanceSplitVariant` was a persisted enum that no longer exists in the
    // schema. A device that persisted it must still parse cleanly (the loose
    // z.object strips unknown keys) without wiping the rest of the blob.
    preload({
      termsAccepted: { termsAccepted: true, date: '2025-01-01T00:00:00.000Z' },
      hasSeenOnboarding: true,
      balanceSplitVariant: 'list',
      displayCurrency: 'eur',
    });

    const store = await loadStore();

    expect(store.getState().isTermsAccepted()).toBe(true);
    expect(store.getState().hasSeenOnboarding).toBe(true);
    expect(store.getState().displayCurrency).toBe('eur');
  });

  it('keeps terms acceptance when an unknown avatarFallbackVariant is persisted', async () => {
    preload({
      termsAccepted: { termsAccepted: true, date: '2025-01-01T00:00:00.000Z' },
      avatarFallbackVariant: 'some-removed-variant',
    });

    const store = await loadStore();

    expect(store.getState().isTermsAccepted()).toBe(true);
    expect(store.getState().avatarFallbackVariant).toBe('flat');
  });
});
