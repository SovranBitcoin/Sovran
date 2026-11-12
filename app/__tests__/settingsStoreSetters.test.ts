/**
 * @jest-environment node
 *
 * Characterization of the settings store's setters and of what `migrate`
 * does NOT do, beside settingsStorePersistResilience.test.ts (which pins the
 * v3 -> v4 developer reset, field tolerance and the onboarding flag) and the
 * release fixtures. The real store runs against an in-memory AsyncStorage.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

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
const TERMS = { termsAccepted: true, date: '2025-01-01T00:00:00.000Z' };

function preload(state: Record<string, unknown>, version: number) {
  mockMemory[STORAGE_KEY] = JSON.stringify({ state, version });
}

async function loadStore() {
  const mod =
    require('@/shared/stores/global/settingsStore') as typeof import('@/shared/stores/global/settingsStore');
  await mod.useSettingsStore.persist.rehydrate();
  return mod.useSettingsStore;
}

async function settle() {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
}

const saved = () =>
  JSON.parse(mockMemory[STORAGE_KEY]) as { state: Record<string, unknown>; version: number };

beforeEach(() => {
  jest.resetModules();
  for (const k of Object.keys(mockMemory)) delete mockMemory[k];
});

const DEV_FLAGS_ON = {
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
};

describe('migrate', () => {
  it('leaves the developer settings of a v4 blob as they were saved', async () => {
    preload({ termsAccepted: TERMS, hasSeenOnboarding: true, ...DEV_FLAGS_ON }, 4);
    const state = (await loadStore()).getState();

    // QUIRK: the developer reset is guarded only by the version number, and
    // the migrate comment relies on a v4 blob never running it again. Bumping
    // `version` without guarding the reset would wipe these on that upgrade.
    expect(state).toMatchObject(DEV_FLAGS_ON);
  });

  it('keeps developer toggles the v3 -> v4 reset does not list', async () => {
    preload(
      {
        termsAccepted: TERMS,
        hasSeenOnboarding: true,
        layoutGuides: true,
        showTouches: true,
        inProcessProfileSwitch: true,
        vertexCreditsEnabled: true,
        primalHostsDisabled: ['wss://cache2.primal.net/v1'],
      },
      3
    );
    const state = (await loadStore()).getState();

    // QUIRK: the "one-time developer reset" misses these developer toggles,
    // so they survive it. A later fix should change this assertion on purpose.
    expect(state).toMatchObject({
      layoutGuides: true,
      showTouches: true,
      inProcessProfileSwitch: true,
      vertexCreditsEnabled: true,
      primalHostsDisabled: ['wss://cache2.primal.net/v1'],
    });
  });

  it('saves a migrated blob as version 4', async () => {
    preload({ termsAccepted: TERMS, hasSeenOnboarding: true, experimental: true }, 3);
    const store = await loadStore();
    store.getState().setDisplayBtc(1);
    await settle();

    expect(saved().version).toBe(4);
    expect(saved().state.experimental).toBe(false);
  });
});

describe('setters', () => {
  it('setMiddlemanRouting merges a partial change into the saved routing settings', async () => {
    const store = await loadStore();
    const before = store.getState().middlemanRouting;

    store.getState().setMiddlemanRouting({ maxHops: 3 });
    expect(store.getState().middlemanRouting).toEqual({ ...before, maxHops: 3 });

    store.getState().setMiddlemanRouting({ trustMode: 'any' as never, maxFee: 9 });
    expect(store.getState().middlemanRouting).toEqual({
      ...before,
      maxHops: 3,
      trustMode: 'any',
      maxFee: 9,
    });
    await settle();
    expect(saved().state.middlemanRouting).toEqual(store.getState().middlemanRouting);
  });

  it('setPrimalHostEnabled toggles a host on the denylist without duplicates', async () => {
    const store = await loadStore();
    const HOST = 'wss://cache2.primal.net/v1';

    store.getState().setPrimalHostEnabled(HOST, false);
    store.getState().setPrimalHostEnabled(HOST, false);
    expect(store.getState().primalHostsDisabled).toEqual([HOST]);

    store.getState().setPrimalHostEnabled('wss://other.example', false);
    store.getState().setPrimalHostEnabled(HOST, true);
    expect(store.getState().primalHostsDisabled).toEqual(['wss://other.example']);

    store.getState().setPrimalHostEnabled(HOST, true);
    expect(store.getState().primalHostsDisabled).toEqual(['wss://other.example']);
  });

  it('a host disabled again moves to the end of the denylist', async () => {
    const store = await loadStore();
    store.getState().setPrimalHostEnabled('wss://a.example', false);
    store.getState().setPrimalHostEnabled('wss://b.example', false);
    store.getState().setPrimalHostEnabled('wss://a.example', false);

    expect(store.getState().primalHostsDisabled).toEqual(['wss://b.example', 'wss://a.example']);
  });

  it('acceptLegalDocuments keeps the first terms date and stamps the current revisions', async () => {
    preload({ termsAccepted: TERMS, hasSeenOnboarding: true }, 4);
    const store = await loadStore();

    store.getState().acceptLegalDocuments();
    const state = store.getState();

    expect(state.termsAccepted).toEqual(TERMS);
    expect(state.legalAcceptance).toEqual({
      termsRevision: expect.any(String),
      privacyRevision: expect.any(String),
      acceptedAt: expect.any(String),
    });
    expect(state.termsAccepted?.termsAccepted).toBe(true);
  });

  it('acceptLegalDocuments on a fresh install records the terms with today’s date', async () => {
    const store = await loadStore();
    expect(store.getState().termsAccepted).toBeNull();

    store.getState().acceptLegalDocuments();
    const { termsAccepted, legalAcceptance } = store.getState();

    expect(termsAccepted?.termsAccepted).toBe(true);
    expect(termsAccepted?.date).toBe(legalAcceptance?.acceptedAt);
  });

  it('setFileLoggingEnabled saves the flag and switches the file logger at once', async () => {
    const store = await loadStore();
    const { applyFileLogging } = jest.requireMock('@/shared/lib/logger') as {
      applyFileLogging: jest.Mock;
    };

    store.getState().setFileLoggingEnabled(true);
    expect(store.getState().fileLoggingEnabled).toBe(true);
    expect(applyFileLogging).toHaveBeenLastCalledWith(true);

    store.getState().setFileLoggingEnabled(false);
    expect(applyFileLogging).toHaveBeenLastCalledWith(false);
  });

  it('every setter change is saved, and runtime-only helpers are not', async () => {
    const store = await loadStore();
    store.getState().setDisplayCurrency('eur' as never);
    store.getState().setMinTransferThreshold(250);
    store.getState().completeOnboarding();
    await settle();

    expect(saved().state).toMatchObject({
      displayCurrency: 'eur',
      minTransferThreshold: 250,
      hasSeenOnboarding: true,
    });
    expect(saved().state).not.toHaveProperty('setDisplayBtc');
  });
});
