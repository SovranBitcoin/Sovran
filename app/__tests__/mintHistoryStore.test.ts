/* eslint-disable import/first */
// `mint-history-store`: one baseline per mint, bounded revisions, LRU that
// spares the wallet's mints, throttled unchanged writes, and a reload that
// brings everything back.

const mockDisk = new Map<string, string>();
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockDisk.set(key, value);
    },
    removeItem: async (key: string) => {
      mockDisk.delete(key);
    },
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    storeLog: sink,
    cashuLog: sink,
    apiLog: sink,
    redactError: (e: unknown) => e,
  };
});

import {
  applyMintInfoPatch,
  canonicalizeMintInfo,
  invertPatch,
} from '@/features/mint/lib/mintChanges/localDiff';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import {
  failureBackoffMs,
  MAX_MINTS,
  MAX_REVISIONS,
  RECHECK_AFTER_SUCCESS_MS,
  SEEN_WRITE_THROTTLE_MS,
  useMintHistoryStore,
} from '@/shared/stores/profile/mintHistoryStore';

const MINT = 'https://mint.sovran.money';
const KEY = normalizeMintUrlKey(MINT);
const HOUR = 3_600_000;
const doc = (over: Record<string, unknown> = {}) =>
  canonicalizeMintInfo({ name: 'Sovran', pubkey: '02ab', version: 'v1', ...over })!;
const store = () => useMintHistoryStore.getState();
const entry = () => store().byMintUrl[KEY]!;

beforeEach(async () => {
  mockDisk.clear();
  await useMintHistoryStore.persist.rehydrate();
  useMintHistoryStore.setState({ byMintUrl: {} });
});

describe('recording', () => {
  it('records the first sighting as a baseline only, never a diff against nothing', () => {
    expect(store().recordObservation(MINT, doc(), 1_000)).toBe('baseline');
    expect(entry()).toMatchObject({
      mintUrl: MINT,
      baseline: doc(),
      firstSeenAt: 1_000,
      lastSeenAt: 1_000,
      consecutiveFailures: 0,
      nextRetryAt: 1_000 + RECHECK_AFTER_SUCCESS_MS,
      revisions: [],
    });
  });

  it('records a change as one revision whose patch walks back to the old baseline', () => {
    store().recordObservation(MINT, doc(), 1_000);
    expect(store().recordObservation(MINT, doc({ version: 'v2' }), 5 * HOUR)).toBe('changed');
    const [revision] = entry().revisions;
    expect(revision).toMatchObject({ at: 5 * HOUR, previousLastSeenAt: 1_000 });
    expect(entry().baseline).toEqual(doc({ version: 'v2' }));
    expect(applyMintInfoPatch(entry().baseline!, invertPatch(revision!.patch))).toEqual(doc());
  });

  it('gives A → B → A two revisions with different ids', () => {
    store().recordObservation(MINT, doc(), 0);
    store().recordObservation(MINT, doc({ version: 'v2' }), HOUR);
    store().recordObservation(MINT, doc(), 2 * HOUR);
    const ids = entry().revisions.map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('gives A → B → A → B in the same millisecond a different id each time', () => {
    store().recordObservation(MINT, doc(), 0);
    store().recordObservation(MINT, doc({ version: 'v2' }), HOUR);
    store().recordObservation(MINT, doc(), HOUR);
    store().recordObservation(MINT, doc({ version: 'v2' }), HOUR);
    const ids = entry().revisions.map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps at most MAX_REVISIONS, newest first', () => {
    for (let i = 0; i <= MAX_REVISIONS + 5; i++) {
      store().recordObservation(MINT, doc({ version: `v${i}` }), i * HOUR);
    }
    expect(entry().revisions).toHaveLength(MAX_REVISIONS);
    expect(entry().revisions[0]!.at).toBe((MAX_REVISIONS + 5) * HOUR);
  });

  it('saves an unchanged answer at most once an hour', () => {
    store().recordObservation(MINT, doc(), 0);
    const before = store().byMintUrl;
    expect(store().recordObservation(MINT, doc(), SEEN_WRITE_THROTTLE_MS - 1)).toBe('unchanged');
    // No write at all: the same state object, so persist has nothing to save.
    expect(store().byMintUrl).toBe(before);
    store().recordObservation(MINT, doc(), SEEN_WRITE_THROTTLE_MS);
    expect(entry().lastSeenAt).toBe(SEEN_WRITE_THROTTLE_MS);
  });

  it('keeps the baseline and history through failures, backing off 5 min .. 24 h', () => {
    store().recordObservation(MINT, doc(), 0);
    store().recordObservation(MINT, doc({ version: 'v2' }), HOUR);
    store().recordFailure(MINT, 2 * HOUR, () => 0.5);
    expect(entry()).toMatchObject({ consecutiveFailures: 1, baseline: doc({ version: 'v2' }) });
    expect(entry().revisions).toHaveLength(1);
    expect(entry().nextRetryAt).toBe(2 * HOUR + 5 * 60_000);
    // An answer after a failure clears the count even when nothing changed.
    store().recordObservation(MINT, doc({ version: 'v2' }), 2 * HOUR + 1);
    expect(entry().consecutiveFailures).toBe(0);
    expect(failureBackoffMs(30, () => 1)).toBe(24 * HOUR);
    expect(failureBackoffMs(1, () => 0)).toBe(4 * 60_000);
  });

  it('drops a snapshot too large to keep', () => {
    expect(store().recordObservation(MINT, doc({ description: 'x'.repeat(40_000) }), 0)).toBe(
      'rejected'
    );
    expect(store().byMintUrl[KEY]?.baseline).toBeUndefined();
  });

  it('backs off a mint whose answer is too large, so the sweep does not fetch it every minute', () => {
    const big = doc({ description: 'x'.repeat(40_000) });
    expect(store().recordObservation(MINT, big, 0)).toBe('rejected');
    expect(entry()).toMatchObject({ consecutiveFailures: 1, revisions: [] });
    expect(entry().baseline).toBeUndefined();
    expect(entry().nextRetryAt).toBeGreaterThanOrEqual(4 * 60_000);
    // A kept baseline is left as it was.
    store().recordObservation(MINT, doc(), HOUR);
    store().recordObservation(MINT, big, 2 * HOUR);
    expect(entry()).toMatchObject({ baseline: doc(), consecutiveFailures: 1 });
    expect(entry().nextRetryAt).toBeGreaterThan(2 * HOUR);
  });
});

describe('prototype-shaped mint URLs', () => {
  const PROTO = ['https://constructor', 'https://__proto__', 'https://hasOwnProperty'];

  it.each(PROTO)(
    'records a failure for %s as a real count, never through Object.prototype',
    (url) => {
      store().recordFailure(url, 0, () => 0.5);
      const held = store().byMintUrl[normalizeMintUrlKey(url)]!;
      expect(Object.hasOwn(store().byMintUrl, normalizeMintUrlKey(url))).toBe(true);
      expect(held.consecutiveFailures).toBe(1);
      expect(Number.isFinite(held.nextRetryAt)).toBe(true);
      expect(Object.getPrototypeOf(store().byMintUrl)).toBe(Object.prototype);
    }
  );

  it.each(PROTO)('records %s as a baseline, then a change', (url) => {
    expect(store().recordObservation(url, doc(), 0)).toBe('baseline');
    expect(store().recordObservation(url, doc({ version: 'v2' }), HOUR)).toBe('changed');
    expect(store().byMintUrl[normalizeMintUrlKey(url)]!.revisions).toHaveLength(1);
  });

  it.each(PROTO)('does not invent an entry when %s is viewed before it was ever seen', (url) => {
    store().markViewed(url, 0);
    expect(Object.keys(store().byMintUrl)).toEqual([]);
  });
});

describe('bounds', () => {
  it('evicts the least recently viewed mint first, and the wallet mints last', () => {
    const url = (i: number) => `https://m${i}.example`;
    store().recordObservation(url(0), doc(), 0);
    store().setTrustedMints([url(0)]);
    for (let i = 1; i <= MAX_MINTS; i++) store().recordObservation(url(i), doc(), i * 1_000);
    const keys = Object.keys(store().byMintUrl);
    expect(keys).toHaveLength(MAX_MINTS);
    // The oldest is the trusted one, yet the oldest untrusted mint went instead.
    expect(keys).toContain(normalizeMintUrlKey(url(0)));
    expect(keys).not.toContain(normalizeMintUrlKey(url(1)));
  });

  it('moves a viewed mint to the back of the eviction order', () => {
    const url = (i: number) => `https://v${i}.example`;
    for (let i = 0; i < MAX_MINTS; i++) store().recordObservation(url(i), doc(), i * 1_000);
    store().markViewed(url(0), 10 * MAX_MINTS * 1_000);
    store().recordObservation(url(MAX_MINTS), doc(), 10 * MAX_MINTS * 1_000 + 1);
    const keys = Object.keys(store().byMintUrl);
    expect(keys).toContain(normalizeMintUrlKey(url(0)));
    expect(keys).not.toContain(normalizeMintUrlKey(url(1)));
  });
});

describe('saved size', () => {
  const utf8 = (text: string) => Buffer.byteLength(text, 'utf8');
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('holds the saved row under 512 KB of UTF-8, counting multi-byte text', async () => {
    // 12,000 UTF-16 units but 28,000 UTF-8 bytes per mint: within the
    // snapshot bound, and 40 of them are over 1 MB on disk.
    const description = '中😀'.repeat(4_000);
    const url = (i: number) => `https://cjk${i}.example`;
    for (let i = 0; i < 40; i++) {
      expect(store().recordObservation(url(i), doc({ description }), i * 1_000)).toBe('baseline');
    }
    await flush();
    const blob = mockDisk.get('mint-history-store')!;
    expect(utf8(blob)).toBeLessThanOrEqual(512 * 1024);
    // The newest mint stays; the least recent ones went.
    expect(store().byMintUrl[normalizeMintUrlKey(url(39))]).toBeDefined();
    expect(store().byMintUrl[normalizeMintUrlKey(url(0))]).toBeUndefined();
  });

  it('drops a snapshot whose UTF-8 is over the bound even when its length is not', () => {
    // 15,000 UTF-16 units, 35,000 UTF-8 bytes.
    expect(store().recordObservation(MINT, doc({ description: '中😀'.repeat(5_000) }), 0)).toBe(
      'rejected'
    );
  });

  it('keeps no pointer the reader would refuse: a revision reloads as it was saved', async () => {
    store().recordObservation(MINT, doc(), 0);
    store().recordObservation(MINT, doc({ ['k'.repeat(1_100)]: 1 }), HOUR);
    const [revision] = entry().revisions;
    expect(revision).toMatchObject({ oversized: true, patch: [] });
    const saved = JSON.parse(JSON.stringify(store().byMintUrl));
    await flush();
    const blob = mockDisk.get('mint-history-store')!;
    useMintHistoryStore.setState({ byMintUrl: {} });
    await flush();
    mockDisk.set('mint-history-store', blob);
    await useMintHistoryStore.persist.rehydrate();
    expect(store().byMintUrl).toEqual(saved);
  });
});

describe('saved data', () => {
  it('comes back the same after a restart', async () => {
    store().recordObservation(MINT, doc(), 0);
    store().recordObservation(MINT, doc({ motd: 'hello' }), HOUR);
    store().setTrustedMints([MINT]);
    const saved = JSON.parse(JSON.stringify(store().byMintUrl));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const blob = mockDisk.get('mint-history-store');
    expect(blob).toBeDefined();
    // A fresh launch: memory starts empty and the saved row is read back.
    useMintHistoryStore.setState({ byMintUrl: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    mockDisk.set('mint-history-store', blob!);
    await useMintHistoryStore.persist.rehydrate();
    expect(store().byMintUrl).toEqual(saved);
  });

  it('drops one unreadable mint without losing the others', () => {
    const schema = persistRegistry.find((e) => e.name === 'mint-history-store')!.schema;
    const good = { mintUrl: MINT, consecutiveFailures: 0, revisions: [] };
    const parsed = schema.parse({
      byMintUrl: { [KEY]: good, 'https://bad.example': { mintUrl: 42 } },
    }) as { byMintUrl: Record<string, unknown> };
    expect(Object.keys(parsed.byMintUrl)).toEqual([KEY]);
  });
});
