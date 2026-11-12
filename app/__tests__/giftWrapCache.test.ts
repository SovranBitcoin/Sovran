/**
 * @jest-environment node
 *
 * `giftWrapCache.unwrap`, the cache in front of NIP-17 gift-wrap decryption:
 * a hit, a miss, the negative cache for wraps that do not open, the
 * per-account scope, what it saves to storage, and what it adopts from
 * storage on the next start. Real gift wraps and real decryption; storage is
 * an in-memory AsyncStorage and timers are faked. The cache factory itself is
 * pinned by pubkeyScopedCache.test.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPublicKey } from 'nostr-tools/pure';

import { buildRecipientGiftWrap } from '@/shared/lib/nostr/nip17';

const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void mockDisk.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockDisk.delete(key)),
  },
}));

const SENDER_SECRET = new Uint8Array(32).fill(1);
const ALICE_SECRET = new Uint8Array(32).fill(2);
const BOB_SECRET = new Uint8Array(32).fill(3);
const SENDER = getPublicKey(SENDER_SECRET);
const ALICE = getPublicKey(ALICE_SECRET);
const BOB = getPublicKey(BOB_SECRET);

function wrapFor(recipient: string, content: string) {
  const { recipientWrap } = buildRecipientGiftWrap({
    content,
    senderPrivateKey: SENDER_SECRET,
    recipientPublicKey: recipient,
  });
  return { id: recipientWrap.id, content: recipientWrap.content, pubkey: recipientWrap.pubkey };
}

/** A fresh module instance, as after an app restart. */
function loadCache(): typeof import('@/shared/lib/nostr/giftWrapCache').giftWrapCache {
  let loaded!: typeof import('@/shared/lib/nostr/giftWrapCache').giftWrapCache;
  jest.isolateModules(() => {
    loaded = jest.requireActual('@/shared/lib/nostr/giftWrapCache').giftWrapCache;
  });
  return loaded;
}

async function flushSaves() {
  await jest.advanceTimersByTimeAsync(1_000);
}

const stored = (key: string) => JSON.parse(mockDisk.get(key) ?? 'null');

beforeEach(() => {
  jest.useFakeTimers();
  mockDisk.clear();
  jest.mocked(AsyncStorage.setItem).mockClear();
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('unwrapping through the cache', () => {
  it('opens a wrap on a miss and saves it under the account after one second', async () => {
    const cache = loadCache();
    const wrap = wrapFor(ALICE, 'hello alice');

    const opened = cache.unwrap(ALICE, wrap, ALICE_SECRET);

    expect(opened).toMatchObject({ content: 'hello alice', senderPubkey: SENDER });
    expect(mockDisk.size).toBe(0);
    await flushSaves();
    expect(stored(`nip17-unwrap-cache:v1:${ALICE}`)).toEqual({
      [wrap.id]: {
        value: expect.objectContaining({ content: 'hello alice', senderPubkey: SENDER }),
        cachedAt: expect.any(Number),
      },
    });
  });

  it('answers a hit from the cache without decrypting again', () => {
    const cache = loadCache();
    const wrap = wrapFor(ALICE, 'cached');
    const first = cache.unwrap(ALICE, wrap, ALICE_SECRET);

    // A wrong key would fail to decrypt; the hit never tries.
    expect(cache.unwrap(ALICE, wrap, BOB_SECRET)).toBe(first);
  });

  it('remembers a wrap that does not open and never tries it again', async () => {
    const cache = loadCache();
    const wrap = wrapFor(ALICE, 'secret');

    expect(cache.unwrap(ALICE, wrap, BOB_SECRET)).toBeNull();
    // QUIRK: the failure is keyed by account and wrap id only, so the same
    // wrap stays unopened even when the right key is offered later.
    expect(cache.unwrap(ALICE, wrap, ALICE_SECRET)).toBeNull();

    await flushSaves();
    expect(Object.keys(stored(`nip17-unwrap-cache-neg:v1:${ALICE}`))).toEqual([wrap.id]);
    expect(mockDisk.has(`nip17-unwrap-cache:v1:${ALICE}`)).toBe(false);
  });

  it("keeps each account's entries apart", () => {
    const cache = loadCache();
    const wrap = wrapFor(ALICE, 'for alice');
    expect(cache.unwrap(ALICE, wrap, ALICE_SECRET)).not.toBeNull();

    // The same wrap looked up for Bob is a miss there, and Bob cannot open it.
    expect(cache.unwrap(BOB, wrap, BOB_SECRET)).toBeNull();
    expect(cache.cache.isKnownFailed(BOB, wrap.id)).toBe(true);
    expect(cache.cache.isKnownFailed(ALICE, wrap.id)).toBe(false);
  });
});

describe('across a restart', () => {
  it('serves saved wraps and saved failures after hydrating, without decrypting', async () => {
    const before = loadCache();
    const good = wrapFor(ALICE, 'kept');
    const bad = wrapFor(BOB, 'not for alice');
    const opened = before.unwrap(ALICE, good, ALICE_SECRET);
    before.unwrap(ALICE, bad, ALICE_SECRET);
    await flushSaves();

    const after = loadCache();
    // Before hydrating, the new instance knows nothing.
    expect(after.cache.get(ALICE, good.id)).toBeUndefined();
    await after.cache.hydrate(ALICE);

    expect(after.unwrap(ALICE, good, BOB_SECRET)).toEqual(opened);
    expect(after.unwrap(ALICE, bad, BOB_SECRET)).toBeNull();
    expect(after.cache.isKnownFailed(ALICE, bad.id)).toBe(true);
  });

  it('drops saved entries that are not unwrapped messages and keeps the rest', async () => {
    const wrap = wrapFor(ALICE, 'valid');
    mockDisk.set(
      `nip17-unwrap-cache:v1:${ALICE}`,
      JSON.stringify({
        broken: { value: { content: 'no sender' }, cachedAt: 1 },
        undated: { value: { senderPubkey: SENDER, content: 'x' } },
        [wrap.id]: {
          value: {
            senderPubkey: SENDER,
            recipientPubkeys: [ALICE],
            content: 'saved',
            created_at: 1,
            kind: 14,
            tags: [],
          },
          cachedAt: 1,
        },
      })
    );

    const cache = loadCache();
    await cache.cache.hydrate(ALICE);

    expect(cache.cache.get(ALICE, 'broken')).toBeUndefined();
    expect(cache.cache.get(ALICE, 'undated')).toBeUndefined();
    expect(cache.unwrap(ALICE, wrap, BOB_SECRET)).toMatchObject({ content: 'saved' });
  });
});
