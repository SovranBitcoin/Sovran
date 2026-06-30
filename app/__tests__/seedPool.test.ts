/**
 * seedPool is additive: it adds missing (wanted ∪ default) relays to the pool
 * and never removes existing ones.
 */
/* eslint-disable import/first */

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    NDKRelay: class NDKRelay {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
    normalizeRelayUrl: (url: string) => url.trim().toLowerCase().replace(/\/+$/, ''),
  }),
  { virtual: true }
);

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Keep the default set tiny + deterministic for the union assertions.
jest.mock('@/shared/lib/nostr/outbox/defaults', () => {
  const actual = jest.requireActual('@/shared/lib/nostr/outbox/defaults');
  return { ...actual, DEFAULT_RELAYS: ['wss://default.com'] };
});

import type NDK from '@nostr-dev-kit/ndk-mobile';

import { seedPool } from '@/shared/lib/nostr/outbox/seedPool';

function fakePool(existing: string[]) {
  const relays = new Map(existing.map((url) => [url, { url }]));
  return {
    relays,
    addRelay: jest.fn((relay: { url: string }) => relays.set(relay.url, relay)),
  };
}

const asNdk = (value: unknown): NDK => value as unknown as NDK;

describe('seedPool', () => {
  it('adds wanted relays missing from the pool, plus defaults', () => {
    const pool = fakePool(['wss://existing.com']);
    const ndk = asNdk({ pool });

    const added = seedPool(ndk, ['wss://existing.com', 'wss://new.com']);

    expect(added.sort()).toEqual(['wss://default.com', 'wss://new.com']);
    expect(pool.addRelay).toHaveBeenCalledTimes(2);
    expect(pool.relays.has('wss://existing.com')).toBe(true); // untouched
  });

  it('is a no-op when everything is already present', () => {
    const pool = fakePool(['wss://default.com', 'wss://a.com']);
    const ndk = asNdk({ pool });

    const added = seedPool(ndk, ['wss://a.com']);

    expect(added).toEqual([]);
    expect(pool.addRelay).not.toHaveBeenCalled();
  });

  it('returns [] when the ndk has no pool', () => {
    expect(seedPool(asNdk({}), ['wss://a.com'])).toEqual([]);
  });
});
