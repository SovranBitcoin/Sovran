import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createNostrDataLayer } from '../src/facade';
import { createRelayPoolConnection, createRelayTier } from '../src/facade/relay';
import { createPrimalTier, createPrimalWebSocketConnection } from '../src/facade/primal';

// ---------------------------------------------------------------------------
// Counted, end to end over fake sockets: a cold list of 50 people, each row
// asking for its own profile, against one Primal cache host and five relays.
//
// "Per row" is what the rows did before batching (one getProfiles each).
// "Batched" is what they do now. Sockets opened and REQ frames sent are read
// off the sockets themselves. Nothing here touches a real network.
// ---------------------------------------------------------------------------

const PRIMAL = 'wss://cache.test';
const RELAYS = ['wss://r1.test', 'wss://r2.test', 'wss://r3.test', 'wss://r4.test', 'wss://r5.test'];
const PUBKEYS = Array.from({ length: 50 }, (_, index) => index.toString(16).padStart(64, '0'));

class CountedSocket {
  static instances: CountedSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  reqs = 0;
  constructor(public url: string) {
    CountedSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }
  send(raw: string) {
    const frame = JSON.parse(raw) as [string, string, { authors?: string[]; cache?: [string, { pubkeys: string[] }] }];
    if (frame[0] !== 'REQ') return;
    this.reqs += 1;
    const asked = frame[2].authors ?? frame[2].cache?.[1].pubkeys ?? [];
    queueMicrotask(() => {
      for (const pubkey of asked) {
        this.onmessage?.({
          data: JSON.stringify([
            'EVENT',
            frame[1],
            { id: `${pubkey.slice(2)}ee`, pubkey, kind: 0, content: '{"name":"n"}', created_at: 1_700_000_000 },
          ]),
        });
      }
      this.onmessage?.({ data: JSON.stringify(['EOSE', frame[1]]) });
    });
  }
  close() {}
}

const Impl = CountedSocket as unknown as new (url: string) => never;

function layer() {
  return createNostrDataLayer({
    tiers: [
      createPrimalTier({ connection: createPrimalWebSocketConnection({ url: PRIMAL, WebSocketImpl: Impl }) }),
      createRelayTier({
        connection: createRelayPoolConnection({ relays: RELAYS, WebSocketImpl: Impl, settleMs: 0 }),
      }),
    ],
  });
}

const count = () => {
  const primal = CountedSocket.instances.filter((socket) => socket.url === PRIMAL);
  const relay = CountedSocket.instances.filter((socket) => socket.url !== PRIMAL);
  const reqs = (sockets: CountedSocket[]) => sockets.reduce((sum, socket) => sum + socket.reqs, 0);
  return {
    primalSockets: primal.length,
    primalReqs: reqs(primal),
    relaySockets: relay.length,
    relayReqs: reqs(relay),
  };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  CountedSocket.instances = [];
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('a cold list of 50 profiles, counted on the sockets', () => {
  test('one fetch per row: 50 REQs to the cache, 250 to the relays, 7 sockets per relay', async () => {
    const data = layer();
    const reads = PUBKEYS.map((pubkey) => data.getProfiles({ pubkeys: [pubkey], refresh: true }));
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all(reads);
    expect(count()).toEqual({
      // The cache socket is shared now; before this branch it was one socket
      // per request (50), as facade-primal-multiplex.test.ts shows.
      primalSockets: 1,
      primalReqs: 50,
      // A relay socket carries 8 subscriptions, so 50 at once need 7 per relay.
      relaySockets: 35,
      relayReqs: 250,
    });
  });

  test('batched: 1 REQ to the cache, 1 per relay, 1 socket each', async () => {
    const data = layer();
    const reads = PUBKEYS.map((pubkey) => data.loadProfiles([pubkey]));
    await vi.advanceTimersByTimeAsync(50);
    const loaded = await Promise.all(reads);
    expect(loaded.every((result, index) => result[PUBKEYS[index]!]?.name === 'n')).toBe(true);
    expect(count()).toEqual({ primalSockets: 1, primalReqs: 1, relaySockets: 5, relayReqs: 5 });
  });
});
