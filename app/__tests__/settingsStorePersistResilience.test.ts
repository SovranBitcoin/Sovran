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
  purgeLegacyMockData: jest.fn(),
}));

const STORAGE_KEY = 'settings-store';

function preload(state: Record<string, unknown>, version = 3) {
  mockMemory[STORAGE_KEY] = JSON.stringify({ state, version });
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

  it('keeps terms acceptance when a removed avatarFallbackVariant is still in the blob (v4, no migrate)', async () => {
    // `avatarFallbackVariant` was the persisted avatar-style picker enum,
    // removed when the single clay fallback shipped. A device that persisted it
    // must still parse cleanly (unknown keys strip) without wiping the blob.
    preload(
      {
        termsAccepted: { termsAccepted: true, date: '2025-01-01T00:00:00.000Z' },
        hasSeenOnboarding: true,
        avatarFallbackVariant: 'pixel',
        displayCurrency: 'eur',
      },
      4
    );

    const store = await loadStore();

    expect(store.getState().isTermsAccepted()).toBe(true);
    expect(store.getState().hasSeenOnboarding).toBe(true);
    expect(store.getState().displayCurrency).toBe('eur');
    expect('avatarFallbackVariant' in store.getState()).toBe(false);
  });

  it('keeps terms acceptance when an old v2 blob still carries avatarFallbackVariant (migrate path)', async () => {
    preload(
      {
        termsAccepted: { termsAccepted: true, date: '2025-01-01T00:00:00.000Z' },
        avatarFallbackVariant: 'beam',
      },
      2
    );

    const store = await loadStore();

    expect(store.getState().isTermsAccepted()).toBe(true);
    expect('avatarFallbackVariant' in store.getState()).toBe(false);
  });

  it('v3 -> v4 resets every developer setting without touching user settings', async () => {
    preload(
      {
        termsAccepted: { termsAccepted: true, date: '2025-01-01T00:00:00.000Z' },
        hasSeenOnboarding: true,
        displayCurrency: 'eur',
        experimental: true,
        mockMode: true,
        mockOffline: true,
        mockFailSend: true,
        mockFailMelt: true,
        mockFailPaymentRequest: true,
        mockNoGlass: true,
        whitenoiseEnabled: true,
        fileLoggingEnabled: true,
        naggTierEnabled: false,
        primalTierEnabled: false,
        relayTierEnabled: false,
      },
      3
    );

    const store = await loadStore();
    const state = store.getState();

    // Dev mode + every developer toggle back to defaults.
    expect(state.experimental).toBe(false);
    expect(state.mockMode).toBe(false);
    expect(state.mockOffline).toBe(false);
    expect(state.mockFailSend).toBe(false);
    expect(state.mockFailMelt).toBe(false);
    expect(state.mockFailPaymentRequest).toBe(false);
    expect(state.mockNoGlass).toBe(false);
    expect(state.whitenoiseEnabled).toBe(false);
    expect(state.fileLoggingEnabled).toBe(false);
    expect(state.naggTierEnabled).toBe(true);
    expect(state.primalTierEnabled).toBe(true);
    expect(state.relayTierEnabled).toBe(true);

    // User settings survive.
    expect(state.isTermsAccepted()).toBe(true);
    expect(state.hasSeenOnboarding).toBe(true);
    expect(state.displayCurrency).toBe('eur');
  });
});

describe('versioned legal acceptance', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockMemory)) delete mockMemory[k];
  });

  it('reprompts legacy installations without losing settings or the original notification cutoff', async () => {
    const legacy = { termsAccepted: true, date: '2026-06-08' };
    preload({ termsAccepted: legacy, hasSeenOnboarding: true, displayCurrency: 'gbp' });
    const store = await loadStore();
    const { hasCurrentLegalAcceptance } = require('@/shared/lib/legal/legalDocuments');
    expect(hasCurrentLegalAcceptance(store.getState().legalAcceptance)).toBe(false);
    store.getState().acceptLegalDocuments();
    expect(hasCurrentLegalAcceptance(store.getState().legalAcceptance)).toBe(true);
    expect(store.getState().termsAccepted).toEqual(legacy);
    expect(store.getState().displayCurrency).toBe('gbp');
    expect(store.getState().hasSeenOnboarding).toBe(true);
    await store.persist.rehydrate();
    expect(hasCurrentLegalAcceptance(store.getState().legalAcceptance)).toBe(true);
  });

  it.each(['termsRevision', 'privacyRevision'])('reprompts when %s differs', async (field) => {
    const store = await loadStore();
    const { hasCurrentLegalAcceptance } = require('@/shared/lib/legal/legalDocuments');
    store.getState().acceptLegalDocuments();
    const record = store.getState().legalAcceptance!;
    preload({ legalAcceptance: { ...record, [field]: 'a'.repeat(64) }, displayCurrency: 'eur' });
    await store.persist.rehydrate();
    expect(hasCurrentLegalAcceptance(store.getState().legalAcceptance)).toBe(false);
    expect(store.getState().displayCurrency).toBe('eur');
  });

  it.each([
    null,
    true,
    {},
    { termsRevision: 'bad' },
    {
      termsRevision: 'a'.repeat(64),
      privacyRevision: 'b'.repeat(64),
      acceptedAt: 'yesterday',
    },
  ])(
    'rejects invalid legal acceptance locally without resetting other settings: %j',
    async (legalAcceptance) => {
      preload({ legalAcceptance, hasSeenOnboarding: true, displayCurrency: 'eur' });
      const store = await loadStore();
      expect(store.getState().legalAcceptance).toBeNull();
      expect(store.getState().displayCurrency).toBe('eur');
      expect(store.getState().hasSeenOnboarding).toBe(true);
    }
  );
});

test('failed settings hydration preserves the unreadable blob and exposes retryable error state', async () => {
  jest.resetModules();
  mockMemory[STORAGE_KEY] = '{broken json';
  const store = await loadStore();
  const { useSettingsHydration } = require('@/shared/stores/global/settingsStore');
  expect(useSettingsHydration.getState().status).toBe('error');
  expect(mockMemory[STORAGE_KEY]).toBe('{broken json');
  preload({ displayCurrency: 'eur', hasSeenOnboarding: true });
  await store.persist.rehydrate();
  expect(useSettingsHydration.getState().status).toBe('ready');
  expect(store.getState().displayCurrency).toBe('eur');
});
