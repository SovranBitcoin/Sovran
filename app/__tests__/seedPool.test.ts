/**
 * seedPool is additive: it asks the client for missing (wanted ∪ default)
 * relays and never removes existing ones.
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Keep the default set tiny + deterministic for the union assertions.
jest.mock('@/shared/lib/nostr/outbox/defaults', () => {
  const actual = jest.requireActual('@/shared/lib/nostr/outbox/defaults');
  return { ...actual, DEFAULT_RELAYS: ['wss://default.com'] };
});

import { NostrClient } from 'nostr/client';

import { seedPool } from '@/shared/lib/nostr/outbox/seedPool';

/** A real client over sockets that never open, so pool membership is all that changes. */
function clientWith(existing: string[]) {
  class IdleSocket {
    readyState = 0;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    send() {}
    close() {}
  }
  return new NostrClient({ relays: existing, WebSocketImpl: IdleSocket as never });
}

const clients: NostrClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.dispose()));

describe('seedPool', () => {
  it('adds wanted relays missing from the pool, plus defaults', () => {
    const client = clientWith(['wss://existing.com']);
    clients.push(client);

    const added = seedPool(client, ['wss://existing.com', 'wss://new.com']);

    expect(added.sort()).toEqual(['wss://default.com/', 'wss://new.com/']);
    expect(client.relayUrls()).toContain('wss://existing.com/'); // untouched
    expect(client.relayUrls()).toHaveLength(3);
  });

  it('is a no-op when everything is already present', () => {
    const client = clientWith(['wss://default.com', 'wss://a.com']);
    clients.push(client);

    expect(seedPool(client, ['wss://a.com'])).toEqual([]);
    expect(client.relayUrls()).toHaveLength(2);
  });

  it('adds nothing once the client is disposed', () => {
    const client = clientWith([]);
    client.dispose();
    expect(seedPool(client, ['wss://a.com'])).toEqual([]);
  });
});
