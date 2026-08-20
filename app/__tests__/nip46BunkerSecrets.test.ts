/**
 * Bunker pairing secrets: SecureStore-backed one-time bearer credentials.
 * Load-bearing cases: single-use atomicity (a secret can be consumed exactly
 * once, even by concurrent racers), consume-then-ack ordering (the deletion
 * write lands before ok(true) — a failed write must never ack), TTL pruning
 * on every read, and the 8-entry cap evicting oldest-first.
 */

/* eslint-disable import/first */

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __backing: store,
  };
});

import * as SecureStore from 'expo-secure-store';
import type { ResultAsync } from 'neverthrow';

import {
  clearSecrets,
  consumeSecret,
  hasOutstanding,
  listOutstanding,
  mintSecret,
} from '@/features/nostrSigner/lib/bunkerSecrets';
import { BUNKER_SECRET_TTL_MS } from '@/features/nostrSigner/lib/nip46Types';

const mocked = SecureStore as unknown as {
  __backing: Map<string, string>;
  deleteItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const KEY_A = `nip46_bunker_secrets_${PUBKEY_A}`;
const T0 = 1_700_000_000_000;
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

async function expectOk<T, E>(resultAsync: ResultAsync<T, E>): Promise<T> {
  const result = await resultAsync;
  expect(result.isErr()).toBe(false);
  return result._unsafeUnwrap();
}

beforeEach(() => {
  mocked.__backing.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'crypto');
  }
});

describe('mintSecret', () => {
  it('returns 32 lowercase hex chars and persists entry with the 10-min TTL', async () => {
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    expect(secret).toMatch(/^[0-9a-f]{32}$/);

    const blob = JSON.parse(mocked.__backing.get(KEY_A)!);
    expect(blob).toEqual([{ secret, createdAt: T0, expiresAt: T0 + BUNKER_SECRET_TTL_MS }]);
  });

  it('mints distinct secrets across calls', async () => {
    const first = await expectOk(mintSecret(PUBKEY_A, T0));
    const second = await expectOk(mintSecret(PUBKEY_A, T0));
    expect(first).not.toBe(second);
  });

  it('fails closed and persists nothing when the CSPRNG throws', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: () => {
          throw new Error('native rng unavailable');
        },
      },
    });

    const result = await mintSecret(PUBKEY_A, T0);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe('csprng-failed');
    expect(mocked.setItemAsync).not.toHaveBeenCalled();
    expect(mocked.__backing.has(KEY_A)).toBe(false);
  });

  it('caps outstanding secrets at 8, evicting oldest first', async () => {
    const secrets: string[] = [];
    for (let i = 0; i < 9; i++) {
      secrets.push(await expectOk(mintSecret(PUBKEY_A, T0 + i)));
    }

    const outstanding = await expectOk(listOutstanding(PUBKEY_A, T0 + 100));
    expect(outstanding).toHaveLength(8);
    expect(outstanding.map((e) => e.secret)).toEqual(secrets.slice(1));

    expect(await expectOk(consumeSecret(PUBKEY_A, secrets[0]!, T0 + 100))).toBe(false);
    expect(await expectOk(consumeSecret(PUBKEY_A, secrets[8]!, T0 + 100))).toBe(true);
  });

  it('rejects an invalid pubkey', async () => {
    const result = await mintSecret('not-a-pubkey', T0);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'invalid-pubkey' });
  });
});

describe('consumeSecret single-use atomicity', () => {
  it('consumes exactly once: second sequential consume fails', async () => {
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    expect(await expectOk(consumeSecret(PUBKEY_A, secret, T0 + 1))).toBe(true);
    expect(await expectOk(consumeSecret(PUBKEY_A, secret, T0 + 2))).toBe(false);
  });

  it('serialises concurrent consumes: exactly one racer wins', async () => {
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    const [first, second] = await Promise.all([
      consumeSecret(PUBKEY_A, secret, T0 + 1),
      consumeSecret(PUBKEY_A, secret, T0 + 1),
    ]);
    const verdicts = [first._unsafeUnwrap(), second._unsafeUnwrap()];
    expect(verdicts.filter(Boolean)).toHaveLength(1);
  });

  it('completes the deletion write before resolving true (consume-then-ack)', async () => {
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    expect(await expectOk(consumeSecret(PUBKEY_A, secret, T0 + 1))).toBe(true);
    // By the time ok(true) is observable the backing store no longer holds it.
    expect(mocked.__backing.get(KEY_A) ?? '').not.toContain(secret);
  });

  it('surfaces a failed deletion write as err — caller must not ack', async () => {
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    // Sole entry → persist path is deleteItemAsync; make that write fail once.
    mocked.deleteItemAsync.mockRejectedValueOnce(new Error('keychain busy'));

    const failed = await consumeSecret(PUBKEY_A, secret, T0 + 1);
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().type).toBe('storage-write-failed');

    // Secret was not burned by the failed write; a retry can still consume it.
    expect(await expectOk(consumeSecret(PUBKEY_A, secret, T0 + 2))).toBe(true);
  });

  it('does not consume across pubkeys', async () => {
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    expect(await expectOk(consumeSecret(PUBKEY_B, secret, T0 + 1))).toBe(false);
    expect(await expectOk(consumeSecret(PUBKEY_A, secret, T0 + 1))).toBe(true);
  });
});

describe('TTL pruning', () => {
  it('refuses an expired secret and prunes it from storage', async () => {
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    const atExpiry = T0 + BUNKER_SECRET_TTL_MS;
    expect(await expectOk(consumeSecret(PUBKEY_A, secret, atExpiry))).toBe(false);
    expect(mocked.__backing.has(KEY_A)).toBe(false);
  });

  it('prunes only expired entries on read, keeping live ones', async () => {
    const stale = await expectOk(mintSecret(PUBKEY_A, T0));
    const fresh = await expectOk(mintSecret(PUBKEY_A, T0 + 60_000));

    const outstanding = await expectOk(listOutstanding(PUBKEY_A, T0 + BUNKER_SECRET_TTL_MS + 1));
    expect(outstanding.map((e) => e.secret)).toEqual([fresh]);

    const blob = JSON.parse(mocked.__backing.get(KEY_A)!) as { secret: string }[];
    expect(blob.map((e) => e.secret)).toEqual([fresh]);
    expect(blob.map((e) => e.secret)).not.toContain(stale);
  });

  it('hasOutstanding flips to false once everything expires', async () => {
    await expectOk(mintSecret(PUBKEY_A, T0));
    expect(await expectOk(hasOutstanding(PUBKEY_A, T0 + 1))).toBe(true);
    expect(await expectOk(hasOutstanding(PUBKEY_A, T0 + BUNKER_SECRET_TTL_MS))).toBe(false);
  });
});

describe('clearSecrets and self-heal', () => {
  it('clearSecrets removes the blob for that pubkey only', async () => {
    await expectOk(mintSecret(PUBKEY_A, T0));
    await expectOk(mintSecret(PUBKEY_B, T0));

    await expectOk(clearSecrets(PUBKEY_A));
    expect(await expectOk(hasOutstanding(PUBKEY_A, T0 + 1))).toBe(false);
    expect(await expectOk(hasOutstanding(PUBKEY_B, T0 + 1))).toBe(true);
  });

  it('self-heals a corrupt blob to empty instead of failing every read', async () => {
    mocked.__backing.set(KEY_A, '{not json');
    expect(await expectOk(listOutstanding(PUBKEY_A, T0))).toEqual([]);
    expect(mocked.__backing.has(KEY_A)).toBe(false);

    // And minting works again on the healed slate.
    const secret = await expectOk(mintSecret(PUBKEY_A, T0));
    expect(await expectOk(consumeSecret(PUBKEY_A, secret, T0 + 1))).toBe(true);
  });

  it('self-heals a schema-invalid blob (wrong entry shape)', async () => {
    mocked.__backing.set(KEY_A, JSON.stringify([{ secret: 'short', createdAt: T0 }]));
    expect(await expectOk(listOutstanding(PUBKEY_A, T0))).toEqual([]);
    expect(mocked.__backing.has(KEY_A)).toBe(false);
  });
});
