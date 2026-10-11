/** @jest-environment node */
import {
  globalRowsWrittenByMigrations,
  runGlobalMigrations,
} from '@/shared/lib/migrations/globalMigrations';

type StorageMap = Record<string, string>;
let mockStorage: StorageMap = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStorage[key];
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const COMPLETED_KEY = 'global-migrations-completed';
const OTHERS_DONE = ['index-to-pubkey-keys-v2', 'legacy-global-theme-to-profile-v1'];
const onboarded = JSON.stringify({ state: { hasSeenOnboarding: true }, version: 4 });

/** Run with the stamp migration not yet recorded, as on first upgrade or a replay. */
async function runStamp(store: StorageMap): Promise<StorageMap> {
  mockStorage = { [COMPLETED_KEY]: JSON.stringify(OTHERS_DONE), ...store };
  await runGlobalMigrations();
  return mockStorage;
}

const lifecycle = (state: Record<string, unknown>) => JSON.stringify({ state, version: 1 });

it('stamps an upgrader who has no lifecycle record, so they skip the restore gate', async () => {
  const after = await runStamp({ 'settings-store': onboarded });

  const stamped = JSON.parse(after['wallet-lifecycle']!).state;
  expect(typeof stamped.seedCreatedAt).toBe('number');
  expect(stamped.restoreStatus).toBe('not-needed');
});

it('stamps an upgrader whose store wrote its defaults before the migration ran', async () => {
  const after = await runStamp({
    'settings-store': onboarded,
    'wallet-lifecycle': lifecycle({ seedCreatedAt: null, restoreStatus: 'unknown' }),
  });

  expect(JSON.parse(after['wallet-lifecycle']!).state.restoreStatus).toBe('not-needed');
});

it.each(['pending', 'in-progress', 'failed', 'complete'])(
  'leaves a wallet whose restore is %s exactly as it was when the migration is replayed',
  async (restoreStatus) => {
    // Recovery writes this record with `seedCreatedAt: null`. A replay happens
    // when the completion marker cannot be read. Stamping here would mark the
    // restore as not needed and let the wallet skip it.
    const recorded = lifecycle({ seedCreatedAt: null, restoreStatus, lastRestoreAt: null });

    const after = await runStamp({ 'settings-store': onboarded, 'wallet-lifecycle': recorded });

    expect(after['wallet-lifecycle']).toBe(recorded);
  }
);

describe('an install from before the onboarding flag (0.0.61 and earlier)', () => {
  // stores/settingsStore.ts:386@a838d5bc3: the accepted terms, and no `hasSeenOnboarding` key.
  const accepted = { termsAccepted: true, date: '2025-03-02T10:00:00.000Z' };
  const settings = (state: Record<string, unknown>, version = 0) =>
    JSON.stringify({ state: { language: 'en', ...state }, version });

  it('is stamped from its accepted terms, and its settings are left as they were', async () => {
    const saved = settings({ termsAccepted: accepted });

    const after = await runStamp({ 'settings-store': saved });

    const stamped = JSON.parse(after['wallet-lifecycle']!).state;
    expect(typeof stamped.seedCreatedAt).toBe('number');
    expect(stamped.restoreStatus).toBe('not-needed');
    // The flag is the settings store's to add, in its own `migrate`.
    expect(after['settings-store']).toBe(saved);
  });

  it('reports the lifecycle row as written, for the caller to load again', async () => {
    await runStamp({ 'settings-store': settings({ termsAccepted: accepted }) });

    expect([...globalRowsWrittenByMigrations()]).toContain('wallet-lifecycle');
  });

  it('is not stamped when the terms were never accepted', async () => {
    const after = await runStamp({ 'settings-store': settings({ termsAccepted: null }) });

    expect(after['wallet-lifecycle']).toBeUndefined();
  });

  it('is left alone when a restore has already been asked for', async () => {
    const recorded = lifecycle({ seedCreatedAt: null, restoreStatus: 'pending' });

    const after = await runStamp({
      'settings-store': settings({ termsAccepted: accepted }),
      'wallet-lifecycle': recorded,
    });

    expect(after['wallet-lifecycle']).toBe(recorded);
  });
});

describe('an install that is not an existing wallet', () => {
  it('writes nothing for a reinstall: the keychain survived and storage is empty', async () => {
    const after = await runStamp({});

    expect(after['wallet-lifecycle']).toBeUndefined();
    expect(after['settings-store']).toBeUndefined();
  });

  it('does not stamp a release with the flag that accepted the terms and has not finished onboarding', async () => {
    // 0.0.62 on always saves the key. This is a new install part-way through
    // setup, or a reinstall the gate has yet to send to restore.
    const midSetup = JSON.stringify({
      state: {
        termsAccepted: { termsAccepted: true, date: '2026-01-01T00:00:00.000Z' },
        hasSeenOnboarding: false,
      },
      version: 4,
    });

    const after = await runStamp({ 'settings-store': midSetup });

    expect(after['wallet-lifecycle']).toBeUndefined();
    expect(after['settings-store']).toBe(midSetup);
  });
});
