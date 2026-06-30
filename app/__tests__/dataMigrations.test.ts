/* eslint-disable import/first */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
});

// Replace the real import step + hydration wait with controllable fakes.
const mockImportStep = jest.fn(() => Promise.resolve());
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  whenHydrated: () => Promise.resolve(),
  importLegacyTransactionSideData: () => mockImportStep(),
}));

import { runDataMigrations } from '@/shared/lib/migrations/dataMigrations';
import { useDataMigrationStore } from '@/shared/stores/profile/dataMigrationStore';

describe('runDataMigrations', () => {
  beforeEach(() => {
    mockImportStep.mockReset().mockResolvedValue(undefined);
    useDataMigrationStore.setState({ level: 0 });
  });

  it('runs pending steps and advances the level', async () => {
    await runDataMigrations();
    expect(mockImportStep).toHaveBeenCalledTimes(1);
    expect(useDataMigrationStore.getState().level).toBe(1);
  });

  it('is a no-op once caught up (level-gated)', async () => {
    useDataMigrationStore.setState({ level: 1 });
    await runDataMigrations();
    expect(mockImportStep).not.toHaveBeenCalled();
    expect(useDataMigrationStore.getState().level).toBe(1);
  });

  it('does not advance the level when a step throws', async () => {
    mockImportStep.mockRejectedValueOnce(new Error('boom'));
    await runDataMigrations();
    expect(useDataMigrationStore.getState().level).toBe(0); // retries next launch
  });
});
