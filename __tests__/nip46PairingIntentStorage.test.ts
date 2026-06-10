/**
 * Profile-switch pairing intent: raw-AsyncStorage single-take blob that must
 * survive the restart-based profile switch. Load-bearing cases: take is
 * single-use (cleared before 'taken' resolves), and stale/mismatched intents
 * are cleared either way while reporting 'expired' | 'mismatch' | 'none'
 * distinctly — the secret-bearing URI must never linger or cross profiles.
 */

/* eslint-disable import/first */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __backing: store,
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearPairingIntent,
  PAIRING_INTENT_STORAGE_KEY,
  setPairingIntent,
  takePairingIntent,
} from '@/features/nostrSigner/lib/pairingIntentStorage';
import { PAIRING_INTENT_TTL_MS } from '@/features/nostrSigner/lib/nip46Types';

const mocked = AsyncStorage as unknown as { __backing: Map<string, string> };

const TARGET_PUBKEY = 'c'.repeat(64);
const OTHER_PUBKEY = 'd'.repeat(64);
const T0 = 1_700_000_000_000;
const URI = 'nostrconnect://abc123?relay=wss%3A%2F%2Frelay.example&secret=deadbeef';

const INPUT = { uri: URI, targetPubkey: TARGET_PUBKEY, targetAccountIndex: 2 };

beforeEach(() => {
  mocked.__backing.clear();
  jest.clearAllMocks();
});

describe('setPairingIntent', () => {
  it('persists the validated intent with TTL timestamps', async () => {
    const result = await setPairingIntent(INPUT, T0);
    expect(result.isOk()).toBe(true);

    const blob = JSON.parse(mocked.__backing.get(PAIRING_INTENT_STORAGE_KEY)!);
    expect(blob).toEqual({
      ...INPUT,
      createdAt: T0,
      expiresAt: T0 + PAIRING_INTENT_TTL_MS,
    });
  });

  it.each([
    ['bad target pubkey', { ...INPUT, targetPubkey: 'zz'.repeat(32) }],
    ['negative account index', { ...INPUT, targetAccountIndex: -1 }],
    ['fractional account index', { ...INPUT, targetAccountIndex: 1.5 }],
    ['empty uri', { ...INPUT, uri: '' }],
    ['oversized uri', { ...INPUT, uri: 'x'.repeat(4097) }],
  ])('rejects %s without writing', async (_label, input) => {
    const result = await setPairingIntent(input, T0);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'invalid-intent' });
    expect(mocked.__backing.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
  });
});

describe('takePairingIntent', () => {
  it('returns none when nothing is stored', async () => {
    const outcome = (await takePairingIntent(TARGET_PUBKEY, T0))._unsafeUnwrap();
    expect(outcome).toEqual({ status: 'none' });
  });

  it('returns-and-clears a matching unexpired intent (single-take)', async () => {
    await setPairingIntent(INPUT, T0);

    const outcome = (await takePairingIntent(TARGET_PUBKEY, T0 + 5_000))._unsafeUnwrap();
    expect(outcome.status).toBe('taken');
    if (outcome.status === 'taken') {
      expect(outcome.intent).toEqual({
        ...INPUT,
        createdAt: T0,
        expiresAt: T0 + PAIRING_INTENT_TTL_MS,
      });
    }
    // Cleared before 'taken' resolved — a second take finds nothing.
    expect(mocked.__backing.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
    const again = (await takePairingIntent(TARGET_PUBKEY, T0 + 5_001))._unsafeUnwrap();
    expect(again).toEqual({ status: 'none' });
  });

  it('still takes at TTL minus one millisecond', async () => {
    await setPairingIntent(INPUT, T0);
    const outcome = (
      await takePairingIntent(TARGET_PUBKEY, T0 + PAIRING_INTENT_TTL_MS - 1)
    )._unsafeUnwrap();
    expect(outcome.status).toBe('taken');
  });

  it('reports expired and clears at exactly the TTL boundary', async () => {
    await setPairingIntent(INPUT, T0);
    const outcome = (
      await takePairingIntent(TARGET_PUBKEY, T0 + PAIRING_INTENT_TTL_MS)
    )._unsafeUnwrap();
    expect(outcome).toEqual({ status: 'expired' });
    expect(mocked.__backing.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
  });

  it('reports mismatch and clears when a different profile boots', async () => {
    await setPairingIntent(INPUT, T0);
    const outcome = (await takePairingIntent(OTHER_PUBKEY, T0 + 5_000))._unsafeUnwrap();
    expect(outcome).toEqual({ status: 'mismatch' });
    expect(mocked.__backing.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);

    // The target profile booting later finds nothing — the secret is gone.
    const after = (await takePairingIntent(TARGET_PUBKEY, T0 + 6_000))._unsafeUnwrap();
    expect(after).toEqual({ status: 'none' });
  });

  it('reports expired (not mismatch) when an intent is both stale and foreign', async () => {
    await setPairingIntent(INPUT, T0);
    const outcome = (
      await takePairingIntent(OTHER_PUBKEY, T0 + PAIRING_INTENT_TTL_MS + 1)
    )._unsafeUnwrap();
    expect(outcome).toEqual({ status: 'expired' });
  });

  it('matches pubkeys case-insensitively', async () => {
    await setPairingIntent({ ...INPUT, targetPubkey: TARGET_PUBKEY.toUpperCase() }, T0);
    const outcome = (await takePairingIntent(TARGET_PUBKEY, T0 + 1_000))._unsafeUnwrap();
    expect(outcome.status).toBe('taken');
  });

  it('clears a corrupt blob and reports none', async () => {
    mocked.__backing.set(PAIRING_INTENT_STORAGE_KEY, '{not json');
    const outcome = (await takePairingIntent(TARGET_PUBKEY, T0))._unsafeUnwrap();
    expect(outcome).toEqual({ status: 'none' });
    expect(mocked.__backing.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
  });

  it('clears a schema-invalid blob and reports none', async () => {
    mocked.__backing.set(
      PAIRING_INTENT_STORAGE_KEY,
      JSON.stringify({ uri: URI, targetPubkey: 'nope' })
    );
    const outcome = (await takePairingIntent(TARGET_PUBKEY, T0))._unsafeUnwrap();
    expect(outcome).toEqual({ status: 'none' });
    expect(mocked.__backing.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
  });

  it('rejects an invalid active pubkey', async () => {
    const result = await takePairingIntent('not-a-pubkey', T0);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'invalid-pubkey' });
  });
});

describe('clearPairingIntent', () => {
  it('removes any stored intent', async () => {
    await setPairingIntent(INPUT, T0);
    const result = await clearPairingIntent();
    expect(result.isOk()).toBe(true);
    expect(mocked.__backing.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
  });
});
