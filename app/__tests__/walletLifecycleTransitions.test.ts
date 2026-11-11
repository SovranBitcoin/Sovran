/**
 * @jest-environment node
 *
 * Characterization of the `wallet-lifecycle` store's own transitions (the
 * restore gate's decisions are pinned in restoreGateDecision.test.tsx, and
 * `awaitRestoreReady` in awaitRestoreReady.test.ts): what each action writes,
 * and what a saved record loads back as. The real store and persist wiring
 * run against an in-memory AsyncStorage.
 */

import { BACKUP_FLOW_REVISION } from '@/shared/lib/backup/revision';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

const mockAsync = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockAsync.set(key, value),
    removeItem: async (key: string) => void mockAsync.delete(key),
  },
}));

const NOW = 1_760_000_000_000;
const INITIAL = {
  seedCreatedAt: null,
  recoveryPhraseVerifiedAt: null,
  recoveryPhraseVerifiedRevision: null,
  restoreStatus: 'unknown' as const,
  lastRestoreAt: null,
  lastRestoreError: null,
};

const state = () => useWalletLifecycleStore.getState();

async function settle() {
  for (let turn = 0; turn < 40; turn++) await new Promise((resolve) => setImmediate(resolve));
}

function saved(): Record<string, unknown> {
  return JSON.parse(mockAsync.get('wallet-lifecycle') ?? 'null')?.state;
}

async function loadFromDisk(record: Record<string, unknown>) {
  useWalletLifecycleStore.setState(INITIAL);
  await settle();
  mockAsync.set('wallet-lifecycle', JSON.stringify({ state: record, version: 0 }));
  await useWalletLifecycleStore.persist.rehydrate();
  await settle();
}

// The module-load read ran before the in-memory disk existed; one good read
// lets the store save again, as it would after a normal launch.
beforeAll(async () => {
  await useWalletLifecycleStore.persist.rehydrate();
});

beforeEach(() => {
  for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
  mockAsync.clear();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  useWalletLifecycleStore.setState(INITIAL);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('markSeedCreatedNow stamps the seed once and never moves the stamp', () => {
  state().markSeedCreatedNow();
  expect(state().seedCreatedAt).toBe(NOW);

  jest.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
  state().markSeedCreatedNow();
  expect(state().seedCreatedAt).toBe(NOW);
});

test('setRestoreStatus clears the error an older build saved', () => {
  useWalletLifecycleStore.setState({
    restoreStatus: 'failed',
    lastRestoreError: 'mint unreachable',
  });

  state().setRestoreStatus('pending');
  expect(state()).toMatchObject({ restoreStatus: 'pending', lastRestoreError: null });
});

test('markRestoreComplete marks complete, stamps the time and clears the last error', () => {
  state().markSeedCreatedNow();
  useWalletLifecycleStore.setState({
    restoreStatus: 'failed',
    lastRestoreError: 'mint unreachable',
  });
  jest.spyOn(Date, 'now').mockReturnValue(NOW + 5_000);

  state().markRestoreComplete();

  expect(state()).toMatchObject({
    restoreStatus: 'complete',
    lastRestoreAt: NOW + 5_000,
    lastRestoreError: null,
    seedCreatedAt: NOW,
  });
});

test('markRecoveryPhraseVerified stamps the time and the current backup flow revision', () => {
  state().markRecoveryPhraseVerified();

  expect(state()).toMatchObject({
    recoveryPhraseVerifiedAt: NOW,
    recoveryPhraseVerifiedRevision: BACKUP_FLOW_REVISION,
  });
});

test('each transition is saved with every lifecycle field', async () => {
  state().markSeedCreatedNow();
  state().markRestoreComplete();
  await settle();

  expect(saved()).toEqual({
    seedCreatedAt: NOW,
    recoveryPhraseVerifiedAt: null,
    recoveryPhraseVerifiedRevision: null,
    restoreStatus: 'complete',
    lastRestoreAt: NOW,
    lastRestoreError: null,
  });
});

test.each(['not-needed', 'pending', 'in-progress', 'complete', 'failed'] as const)(
  'a saved %s status loads back as it was',
  async (restoreStatus) => {
    await loadFromDisk({ seedCreatedAt: NOW, restoreStatus });

    expect(state().restoreStatus).toBe(restoreStatus);
    expect(state().seedCreatedAt).toBe(NOW);
  }
);

test('a saved status this release does not know loads as unknown and keeps the seed stamp', async () => {
  await loadFromDisk({
    seedCreatedAt: NOW,
    restoreStatus: 'restoring-v2',
    lastRestoreAt: NOW,
    recoveryPhraseVerifiedAt: NOW,
    recoveryPhraseVerifiedRevision: 1,
  });

  expect(state()).toMatchObject({
    restoreStatus: 'unknown',
    seedCreatedAt: NOW,
    lastRestoreAt: NOW,
    recoveryPhraseVerifiedAt: NOW,
    recoveryPhraseVerifiedRevision: 1,
  });
});

test('a record from before the verification fields loads with them empty', async () => {
  await loadFromDisk({ seedCreatedAt: NOW, restoreStatus: 'not-needed' });

  expect(state()).toMatchObject({
    recoveryPhraseVerifiedAt: null,
    recoveryPhraseVerifiedRevision: null,
    lastRestoreAt: null,
    lastRestoreError: null,
  });
});

test('a saved restore error over 500 characters loads as none, and the rest of the record stays', async () => {
  await loadFromDisk({
    seedCreatedAt: NOW,
    restoreStatus: 'failed',
    lastRestoreAt: NOW,
    lastRestoreError: 'x'.repeat(501),
  });

  expect(state()).toMatchObject({
    seedCreatedAt: NOW,
    restoreStatus: 'failed',
    lastRestoreAt: NOW,
    lastRestoreError: null,
  });
});
