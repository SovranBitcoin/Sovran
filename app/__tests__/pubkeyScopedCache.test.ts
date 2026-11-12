/**
 * @jest-environment node
 *
 * Characterization of `createPubkeyScopedCache`, the two-tier cache behind the
 * decrypted NIP-17 and NIP-04 message caches: what a hydrate adopts, when
 * entries reach storage, which entries an overflow evicts, what a failed save
 * does, and how account removal waits for saves in flight. The real factory
 * runs against an in-memory AsyncStorage; timers are faked.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createPubkeyScopedCache,
  removePlaintextCaches,
} from '@/shared/lib/cache/createPubkeyScopedCache';
import type { Logger } from '@/shared/lib/logger';

const mockDisk = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void mockDisk.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockDisk.delete(key)),
  },
}));

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

let prefixCount = 0;
function makeCache(extra: { maxEntries?: number; maxNegEntries?: number; neg?: boolean } = {}) {
  prefixCount += 1;
  const prefix = `test-cache-${prefixCount}`;
  const cache = createPubkeyScopedCache<string>({
    storagePrefix: prefix,
    ...(extra.neg === false ? {} : { storagePrefixNeg: `${prefix}-neg` }),
    maxEntries: extra.maxEntries,
    maxNegEntries: extra.maxNegEntries,
    flushDebounceMs: 1000,
    log: log as unknown as Logger,
    validate: (value: unknown): value is string => typeof value === 'string',
  });
  return {
    cache,
    key: (scope: string) => `${prefix}:${scope}`,
    negKey: (scope: string) => `${prefix}-neg:${scope}`,
  };
}

const onDisk = (key: string) => JSON.parse(mockDisk.get(key) ?? 'null');

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  mockDisk.clear();
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementation(async (key, value) => void mockDisk.set(key, value));
  jest.mocked(AsyncStorage.setItem).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

test('hydrate adopts valid saved entries and skips invalid ones', async () => {
  const { cache, key } = makeCache();
  mockDisk.set(
    key(ALICE),
    JSON.stringify({
      ok: { value: 'hello', cachedAt: 5 },
      wrongType: { value: 42, cachedAt: 5 },
      noStamp: { value: 'no stamp' },
      nullEntry: null,
    })
  );
  await cache.hydrate(ALICE);

  expect(cache.get(ALICE, 'ok')).toBe('hello');
  expect(cache.get(ALICE, 'wrongType')).toBeUndefined();
  expect(cache.get(ALICE, 'noStamp')).toBeUndefined();
  expect(cache.get(ALICE, 'nullEntry')).toBeUndefined();
});

test('an unparseable saved blob hydrates as empty without throwing', async () => {
  const { cache, key } = makeCache();
  mockDisk.set(key(ALICE), '{not json');
  await expect(cache.hydrate(ALICE)).resolves.toBeUndefined();
  expect(cache.get(ALICE, 'anything')).toBeUndefined();
});

test('entries are kept per scope', async () => {
  const { cache } = makeCache();
  cache.put(ALICE, 'event-1', 'for alice');

  expect(cache.get(ALICE, 'event-1')).toBe('for alice');
  expect(cache.get(BOB, 'event-1')).toBeUndefined();
});

test('puts are saved together once the debounce passes, under the scope key', async () => {
  const { cache, key } = makeCache();
  cache.put(ALICE, 'event-1', 'one');
  cache.put(ALICE, 'event-2', 'two');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(1000);

  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(onDisk(key(ALICE))).toEqual({
    'event-1': { value: 'one', cachedAt: 1_000_000 },
    'event-2': { value: 'two', cachedAt: 1_000_000 },
  });
});

test('a put made before hydrate loses to the saved value for the same key', async () => {
  const { cache, key } = makeCache();
  mockDisk.set(key(ALICE), JSON.stringify({ shared: { value: 'from disk', cachedAt: 1 } }));
  cache.put(ALICE, 'shared', 'from memory');
  cache.put(ALICE, 'fresh', 'only in memory');

  await cache.hydrate(ALICE);

  // QUIRK: hydrate writes saved entries over what is already in memory, so a
  // newer in-memory value for the same key is replaced by the older one on
  // disk. A later fix should change this assertion on purpose.
  expect(cache.get(ALICE, 'shared')).toBe('from disk');
  expect(cache.get(ALICE, 'fresh')).toBe('only in memory');
});

test('a second hydrate of a loaded scope does not read storage again', async () => {
  const { cache } = makeCache();
  await cache.hydrate(ALICE);
  const reads = jest.mocked(AsyncStorage.getItem).mock.calls.length;
  await cache.hydrate(ALICE);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.length).toBe(reads);
});

test('going one over the cap evicts the oldest tenth of the cap', async () => {
  const { cache } = makeCache({ maxEntries: 20 });
  for (let i = 0; i < 20; i += 1) {
    jest.setSystemTime(1_000_000 + i);
    cache.put(ALICE, `e${i}`, `v${i}`);
  }
  expect(cache.get(ALICE, 'e0')).toBe('v0');

  jest.setSystemTime(2_000_000);
  cache.put(ALICE, 'e20', 'v20');

  // 21 entries over a cap of 20: floor(20 * 0.1) = 2 oldest go.
  expect(cache.get(ALICE, 'e0')).toBeUndefined();
  expect(cache.get(ALICE, 'e1')).toBeUndefined();
  expect(cache.get(ALICE, 'e2')).toBe('v2');
  expect(cache.get(ALICE, 'e20')).toBe('v20');
});

test('with a cap under 10 an overflow evicts nothing and the cache keeps growing', () => {
  const { cache } = makeCache({ maxEntries: 5 });
  for (let i = 0; i < 8; i += 1) cache.put(ALICE, `e${i}`, `v${i}`);

  // QUIRK: floor(5 * 0.1) is 0, so a small cap is never enforced.
  for (let i = 0; i < 8; i += 1) expect(cache.get(ALICE, `e${i}`)).toBe(`v${i}`);
});

test('a failed save stays dirty and is written by the next scheduled save', async () => {
  const { cache, key } = makeCache();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  cache.put(ALICE, 'event-1', 'one');
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockDisk.has(key(ALICE))).toBe(false);
  expect(log.warn).toHaveBeenCalledWith(
    expect.stringContaining('.flush_failed'),
    expect.anything()
  );

  // Nothing retries on its own…
  await jest.advanceTimersByTimeAsync(5000);
  expect(mockDisk.has(key(ALICE))).toBe(false);

  // …the next write's save carries the earlier entry too.
  cache.markFailed(ALICE, 'bad-event');
  await jest.advanceTimersByTimeAsync(1000);
  expect(onDisk(key(ALICE))).toEqual({ 'event-1': { value: 'one', cachedAt: 1_000_000 } });
});

test('failed keys are remembered and saved in their own blob', async () => {
  const { cache, key, negKey } = makeCache();
  expect(cache.isKnownFailed(ALICE, 'bad')).toBe(false);
  cache.markFailed(ALICE, 'bad');
  expect(cache.isKnownFailed(ALICE, 'bad')).toBe(true);
  expect(cache.isKnownFailed(BOB, 'bad')).toBe(false);

  await jest.advanceTimersByTimeAsync(1000);
  expect(onDisk(negKey(ALICE))).toEqual({ bad: 1_000_000 });
  expect(mockDisk.has(key(ALICE))).toBe(false);
});

test('without a negative prefix failed keys are never remembered', () => {
  const { cache } = makeCache({ neg: false });
  cache.markFailed(ALICE, 'bad');
  expect(cache.isKnownFailed(ALICE, 'bad')).toBe(false);
});

test('clear empties memory, cancels the pending save and removes both blobs', async () => {
  const { cache, key, negKey } = makeCache();
  mockDisk.set(key(ALICE), JSON.stringify({ old: { value: 'x', cachedAt: 1 } }));
  mockDisk.set(negKey(ALICE), JSON.stringify({ bad: 1 }));
  cache.put(ALICE, 'event-1', 'one');

  await cache.clear(ALICE);
  await jest.advanceTimersByTimeAsync(1000);

  expect(cache.get(ALICE, 'event-1')).toBeUndefined();
  expect(mockDisk.has(key(ALICE))).toBe(false);
  expect(mockDisk.has(negKey(ALICE))).toBe(false);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('removing an account waits for a save in flight, then deletes only that account’s blobs', async () => {
  const { cache, key, negKey } = makeCache();
  cache.put(BOB, 'event-b', 'bob');
  await jest.advanceTimersByTimeAsync(1000);

  let finishSave: () => void = () => {};
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(
    (k, v) =>
      new Promise<void>((resolve) => {
        finishSave = () => {
          mockDisk.set(k, v);
          resolve();
        };
      })
  );
  cache.put(ALICE, 'event-a', 'alice');
  await jest.advanceTimersByTimeAsync(1000);

  let removed = false;
  const removal = removePlaintextCaches(ALICE).then(() => {
    removed = true;
  });
  await jest.advanceTimersByTimeAsync(0);
  expect(removed).toBe(false);

  finishSave();
  await removal;

  expect(mockDisk.has(key(ALICE))).toBe(false);
  expect(mockDisk.has(negKey(ALICE))).toBe(false);
  expect(onDisk(key(BOB))).toEqual({ 'event-b': { value: 'bob', cachedAt: 1_000_000 } });
  expect(cache.get(ALICE, 'event-a')).toBeUndefined();
});
