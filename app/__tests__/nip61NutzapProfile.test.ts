/**
 * @jest-environment node
 *
 * NIP-61 `kind:10019` parse and lookup.
 *
 * The contract that matters is the opposite of its `kind:10050` sibling's:
 * absence is not a refusal, it is the common case. So every failure path
 * still produces a lock key — the identity-key assumption — and says so
 * through `source`, which is the only thing standing between the sender and a
 * lock they were never told was a guess.
 */

import type { Event as NostrEvent } from 'nostr-tools/core';

import { NUTZAP_INFO_KIND, readNutzapInfo } from '@/shared/lib/nostr/nip61NutzapProfile';
import {
  clearNutzapProfileCache,
  createNutzapProfileResolver,
  type NutzapDiscoveryPool,
} from '@/shared/lib/nostr/nutzapProfileDiscovery';

const IDENTITY = 'a'.repeat(64);
const WALLET_KEY_X = 'b'.repeat(64);

function nutzapInfoEvent(tags: string[][], createdAt = 1_700_000_000): NostrEvent {
  return {
    id: 'c'.repeat(64),
    pubkey: IDENTITY,
    created_at: createdAt,
    kind: NUTZAP_INFO_KIND,
    tags,
    content: '',
    sig: 'd'.repeat(128),
  };
}

describe('readNutzapInfo', () => {
  it('uses the key the recipient declared', () => {
    const profile = readNutzapInfo(nutzapInfoEvent([['pubkey', `02${WALLET_KEY_X}`]]), IDENTITY);
    expect(profile).toMatchObject({
      lockKey: `02${WALLET_KEY_X}`,
      source: 'nutzapInfo',
    });
  });

  it('accepts a 32-byte pubkey tag and lifts it, as NIP-61 requires', () => {
    // NIP-61: "Clients MUST prefix the public key they P2PK-lock with 02".
    // Wallets write the tag both ways; lock to the compressed form either way.
    const profile = readNutzapInfo(nutzapInfoEvent([['pubkey', WALLET_KEY_X]]), IDENTITY);
    expect(profile.lockKey).toBe(`02${WALLET_KEY_X}`);
    expect(profile.source).toBe('nutzapInfo');
  });

  it('assumes the identity key when no event was published', () => {
    const profile = readNutzapInfo(null, IDENTITY);
    expect(profile).toEqual({
      lockKey: `02${IDENTITY}`,
      source: 'identityFallback',
      mints: [],
      relays: [],
      updatedAtSec: null,
    });
  });

  it('keeps their mints but still flags the key as an assumption', () => {
    // They told us where they take ecash, not which key unlocks it. Reporting
    // the key as declared would be claiming something they never said.
    const profile = readNutzapInfo(
      nutzapInfoEvent([['mint', 'https://mint.example', 'sat']]),
      IDENTITY
    );
    expect(profile.mints).toEqual(['https://mint.example']);
    expect(profile.source).toBe('identityFallback');
  });

  it('drops a mint we would not fetch over, and a relay we would not dial', () => {
    const profile = readNutzapInfo(
      nutzapInfoEvent([
        ['mint', 'http://mint.example'],
        ['mint', 'not a url'],
        ['relay', 'https://relay.example'],
        ['relay', 'wss://relay.example'],
      ]),
      IDENTITY
    );
    expect(profile.mints).toEqual([]);
    // normalizeURL maps https to wss, so both relay tags are the same relay
    // and dedupe to one.
    expect(profile.relays).toEqual(['wss://relay.example/']);
  });

  it('ignores an unreadable pubkey tag rather than locking to nonsense', () => {
    const profile = readNutzapInfo(nutzapInfoEvent([['pubkey', 'nope']]), IDENTITY);
    expect(profile.lockKey).toBe(`02${IDENTITY}`);
    expect(profile.source).toBe('identityFallback');
  });
});

function resolverOver(get: NutzapDiscoveryPool['get']) {
  const pool = { get: jest.fn(get) } as unknown as NutzapDiscoveryPool;
  const resolve = createNutzapProfileResolver({
    openPool: () => pool,
    discoveryRelays: ['wss://discovery.example'],
  });
  return { resolve, getMock: pool.get as jest.Mock };
}

describe('createNutzapProfileResolver', () => {
  beforeEach(() => clearNutzapProfileCache());

  it('asks the discovery relays for that author’s kind:10019', async () => {
    const { resolve, getMock } = resolverOver(async () => null);
    await resolve(IDENTITY);

    const [relays, filter] = getMock.mock.calls[0];
    expect(relays).toEqual(['wss://discovery.example']);
    expect(filter).toEqual({ kinds: [NUTZAP_INFO_KIND], authors: [IDENTITY] });
  });

  it('falls back instead of rejecting when the lookup fails', async () => {
    const { resolve } = resolverOver(async () => {
      throw new Error('relay unreachable');
    });
    await expect(resolve(IDENTITY)).resolves.toMatchObject({
      lockKey: `02${IDENTITY}`,
      source: 'identityFallback',
    });
  });

  it('reuses a resolved profile instead of asking again', async () => {
    const { resolve, getMock } = resolverOver(async () =>
      nutzapInfoEvent([['pubkey', `02${WALLET_KEY_X}`]])
    );
    await resolve(IDENTITY);
    await resolve(IDENTITY);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('forgets everything when the payment context is cleared', async () => {
    // A profile switch must not inherit the previous account's lookups.
    const { resolve, getMock } = resolverOver(async () => null);
    await resolve(IDENTITY);
    clearNutzapProfileCache();
    await resolve(IDENTITY);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
