import AsyncStorage from '@react-native-async-storage/async-storage';
import { createQueryCacheStore, isSupersededError } from '@/shared/lib/cache/createQueryCacheStore';
import {
  createPubkeyScopedCache,
  removePlaintextCaches,
} from '@/shared/lib/cache/createPubkeyScopedCache';

import { withSkippedPersistWrites } from '@/shared/lib/persist/profileWriteBarrier';
import { log } from '@/shared/lib/logger';
import { liveStores } from '@/shared/lib/account/accountRegistry';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { log, storeLog: log, monotonicNow: () => 0 };
});

test('query removal drops only the removed viewer and invalidates its late completion', async () => {
  const cache = createQueryCacheStore<string>({
    name: 'removal-query-fixture',
    scope: 'session',
    staleTtlMs: 1000,
    persist: false,
  });
  cache.setEntry('other', 'keep', { viewerKey: 'other' });
  cache.setEntry('target', 'remove', { viewerKey: 'target' });
  let resolve: ((value: { data: string }) => void) | undefined;
  const promise = new Promise<{ data: string }>((done) => {
    resolve = done;
  });
  const late = cache
    .run('new-target-key', () => promise, 'target')
    .catch((error: unknown) => error);
  const registered = liveStores.find((entry) => entry.name === 'removal-query-fixture');
  withSkippedPersistWrites(() => registered?.queryCache?.removeViewer('target'));
  resolve?.({ data: 'late plaintext' });
  expect(isSupersededError(await late)).toBe(true);
  expect(cache.getEntry('new-target-key')).toBeUndefined();
  expect(cache.getEntry('target')).toBeUndefined();
  expect(cache.getEntry('other')?.data).toBe('keep');
});

test('plaintext cache removal preserves the other viewer in memory and on disk', async () => {
  const cache = createPubkeyScopedCache<string>({
    storagePrefix: 'removal-fixture',
    storagePrefixNeg: 'removal-neg-fixture',
    log,
    validate: (value): value is string => typeof value === 'string',
  });
  const other = '{"entry":{"value":"keep","cachedAt":1}}';
  await AsyncStorage.setItem('removal-fixture:other', other);
  await AsyncStorage.setItem('removal-fixture:target', '{"entry":{"value":"remove","cachedAt":1}}');
  await AsyncStorage.setItem('removal-neg-fixture:target', '{"bad":1}');
  await cache.hydrate('other');
  await cache.hydrate('target');
  await removePlaintextCaches('target');
  expect(cache.get('target', 'entry')).toBeUndefined();
  expect(cache.get('other', 'entry')).toBe('keep');
  expect(await AsyncStorage.getItem('removal-fixture:target')).toBeNull();
  expect(await AsyncStorage.getItem('removal-neg-fixture:target')).toBeNull();
  expect(await AsyncStorage.getItem('removal-fixture:other')).toBe(other);
});
