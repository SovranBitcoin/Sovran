/** @jest-environment node */
import { runGlobalMigrations } from '@/shared/lib/migrations/globalMigrations';

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
