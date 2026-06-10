/**
 * NIP-46 transport over a fully mocked @nostr-dev-kit/ndk-mobile.
 * Load-bearing cases: the dedicated "nip46" pool is built with per-relay
 * NIP-42 signIn policies and the exact {kinds, #p, since} filter; start is
 * idempotent; envelope decrypt honours the per-peer pin and reports which
 * scheme actually worked; sendResponse builds a correct signed kind-24133
 * event and resolves on the first relay accept; the generation guard drops
 * late events from stopped subscriptions after rebuild/reconnect/stop.
 * No live sockets — everything is constructor/call introspection.
 */

/* eslint-disable import/first */

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => {
    type MockHandler = (...args: unknown[]) => void;

    class MockEmitter {
      private handlers = new Map<string, MockHandler[]>();
      on = (name: string, fn: MockHandler): void => {
        const list = this.handlers.get(name) ?? [];
        list.push(fn);
        this.handlers.set(name, list);
      };
      off = (name: string, fn: MockHandler): void => {
        this.handlers.set(
          name,
          (this.handlers.get(name) ?? []).filter((handler) => handler !== fn)
        );
      };
      emit = (name: string, ...args: unknown[]): void => {
        for (const fn of this.handlers.get(name) ?? []) fn(...args);
      };
    }

    class MockSubscription extends MockEmitter {
      stop = jest.fn();
      filters: unknown;
      opts: unknown;
      constructor(filters: unknown, opts: unknown) {
        super();
        this.filters = filters;
        this.opts = opts;
      }
    }

    class MockRelay {
      connected = true;
      publish = jest.fn(() => Promise.resolve(true));
      connect = jest.fn(() => Promise.resolve());
      disconnect = jest.fn();
      url: string;
      authPolicy: unknown;
      ndk: unknown;
      constructor(url: string, authPolicy: unknown, ndk: unknown) {
        this.url = url;
        this.authPolicy = authPolicy;
        this.ndk = ndk;
      }
    }

    class MockPool {
      name = '';
      relays = new Map<string, MockRelay>();
      addRelay = jest.fn((relay: MockRelay) => {
        this.relays.set(relay.url, relay);
      });
      removeRelay = jest.fn((url: string) => {
        const relay = this.relays.get(url);
        if (!relay) return false;
        relay.disconnect();
        this.relays.delete(url);
        return true;
      });
    }

    const instances: { ndks: unknown[] } = { ndks: [] };

    class MockNDK {
      pool = new MockPool();
      relayAuthDefaultPolicy: unknown;
      subscriptions: MockSubscription[] = [];
      subscribe = jest.fn((filters: unknown, opts: unknown) => {
        const subscription = new MockSubscription(filters, opts);
        this.subscriptions.push(subscription);
        return subscription;
      });
      opts: unknown;
      constructor(opts: unknown) {
        this.opts = opts;
        instances.ndks.push(this);
      }
    }

    class MockUser {
      pubkey: string;
      constructor(params: { pubkey: string }) {
        this.pubkey = params.pubkey;
      }
    }

    class MockEvent {
      kind?: number;
      content = '';
      tags: string[][] = [];
      created_at?: number;
      sig?: string;
      sign = jest.fn(async () => {
        this.sig = 'sig';
        return 'sig';
      });
      ndk: unknown;
      constructor(ndk: unknown) {
        this.ndk = ndk;
      }
    }

    class MockPrivateKeySigner {}

    const signInPolicy = jest.fn();

    return {
      __esModule: true,
      default: MockNDK,
      NDKEvent: MockEvent,
      NDKPrivateKeySigner: MockPrivateKeySigner,
      NDKRelay: MockRelay,
      NDKRelayAuthPolicies: { signIn: jest.fn(() => signInPolicy), disconnect: jest.fn() },
      NDKSubscriptionCacheUsage: {
        ONLY_CACHE: 'ONLY_CACHE',
        CACHE_FIRST: 'CACHE_FIRST',
        PARALLEL: 'PARALLEL',
        ONLY_RELAY: 'ONLY_RELAY',
      },
      NDKUser: MockUser,
      normalizeRelayUrl: jest.fn((url: string) => {
        const lower = url.toLowerCase();
        return lower.endsWith('/') ? lower : `${lower}/`;
      }),
      __mock: { instances, signInPolicy },
    };
    // virtual: ndk-mobile ships ESM-only exports that jest-expo/node cannot
    // resolve; the factory above fully replaces the module surface used here.
  },
  { virtual: true }
);

import type { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk-mobile';

import { Nip46Transport, PUBLISH_TIMEOUT_MS } from '@/features/nostrSigner/lib/nip46Transport';
import { CREATED_AT_SKEW_SEC, NIP46_RPC_KIND } from '@/features/nostrSigner/lib/nip46Types';

interface MockRelayShape {
  url: string;
  authPolicy: unknown;
  connected: boolean;
  publish: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
}

interface MockSubscriptionShape {
  filters: { kinds: number[]; '#p': string[]; since: number };
  opts: Record<string, unknown>;
  stop: jest.Mock;
  emit: (name: string, ...args: unknown[]) => void;
}

interface MockNdkShape {
  opts: { explicitRelayUrls?: string[] };
  pool: {
    name: string;
    relays: Map<string, MockRelayShape>;
    addRelay: jest.Mock;
    removeRelay: jest.Mock;
  };
  relayAuthDefaultPolicy: unknown;
  subscriptions: MockSubscriptionShape[];
  subscribe: jest.Mock;
}

const mocked = jest.requireMock('@nostr-dev-kit/ndk-mobile') as {
  __mock: { instances: { ndks: MockNdkShape[] }; signInPolicy: jest.Mock };
  NDKRelayAuthPolicies: { signIn: jest.Mock };
};

const USER_PUBKEY = 'f'.repeat(64);
const CLIENT_PUBKEY = 'c'.repeat(64);
const SINCE = 1_700_000_000;

function makeSigner() {
  return {
    nip44Encrypt: jest.fn().mockResolvedValue('ciphertext-44'),
    nip04Encrypt: jest.fn().mockResolvedValue('ciphertext-04'),
    nip44Decrypt: jest.fn().mockResolvedValue('plaintext-44'),
    nip04Decrypt: jest.fn().mockResolvedValue('plaintext-04'),
  };
}
type MockSigner = ReturnType<typeof makeSigner>;

function asSigner(signer: MockSigner): NDKPrivateKeySigner {
  return signer as unknown as NDKPrivateKeySigner;
}

function startTransport(relayUrls: string[] = ['wss://relay.damus.io', 'wss://nos.lol']) {
  const transport = new Nip46Transport();
  const signer = makeSigner();
  const onEvent = jest.fn();
  const result = transport.start({
    signer: asSigner(signer),
    userPubkey: USER_PUBKEY,
    relayUrls,
    sinceEpochSec: SINCE,
    onEvent,
  });
  expect(result.isOk()).toBe(true);
  const ndk = mocked.__mock.instances.ndks[mocked.__mock.instances.ndks.length - 1];
  return { transport, signer, onEvent, ndk };
}

beforeEach(() => {
  mocked.__mock.instances.ndks.length = 0;
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('start', () => {
  it('builds a dedicated nip46 pool with signIn auth policies and the 24133 filter', () => {
    const { signer, ndk } = startTransport();

    expect(mocked.__mock.instances.ndks).toHaveLength(1);
    expect(ndk.pool.name).toBe('nip46');

    // Relay union, normalized + per-relay NIP-42 signIn policy.
    expect([...ndk.pool.relays.keys()].sort()).toEqual(['wss://nos.lol/', 'wss://relay.damus.io/']);
    for (const relay of ndk.pool.relays.values()) {
      expect(relay.authPolicy).toBe(mocked.__mock.signInPolicy);
    }
    expect(ndk.relayAuthDefaultPolicy).toBe(mocked.__mock.signInPolicy);
    expect(mocked.NDKRelayAuthPolicies.signIn).toHaveBeenCalledWith({
      ndk,
      signer: asSigner(signer),
    });

    expect(ndk.subscribe).toHaveBeenCalledTimes(1);
    const subscription = ndk.subscriptions[0];
    expect(subscription.filters).toEqual({
      kinds: [NIP46_RPC_KIND],
      '#p': [USER_PUBKEY],
      since: SINCE,
    });
    expect(subscription.opts).toMatchObject({
      closeOnEose: false,
      groupable: false,
      cacheUsage: 'ONLY_RELAY',
    });
  });

  it('is idempotent: a second start changes nothing', () => {
    const { transport, signer, onEvent, ndk } = startTransport();

    const again = transport.start({
      signer: asSigner(signer),
      userPubkey: USER_PUBKEY,
      relayUrls: ['wss://other.example'],
      sinceEpochSec: SINCE + 100,
      onEvent,
    });

    expect(again.isOk()).toBe(true);
    expect(mocked.__mock.instances.ndks).toHaveLength(1);
    expect(ndk.subscribe).toHaveBeenCalledTimes(1);
    expect(ndk.pool.relays.has('wss://other.example/')).toBe(false);
  });

  it('dedupes equivalent relay urls after normalization', () => {
    const { ndk } = startTransport(['wss://relay.damus.io', 'WSS://RELAY.DAMUS.IO/']);
    expect([...ndk.pool.relays.keys()]).toEqual(['wss://relay.damus.io/']);
  });

  it('errs with no-relays when the url list is empty', () => {
    const transport = new Nip46Transport();
    const result = transport.start({
      signer: asSigner(makeSigner()),
      userPubkey: USER_PUBKEY,
      relayUrls: [],
      sinceEpochSec: SINCE,
      onEvent: jest.fn(),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'no-relays' });
    expect(transport.isStarted).toBe(false);
  });

  it('routes raw subscription events to onEvent and stamps lastEventReceivedAt', () => {
    const { transport, onEvent, ndk } = startTransport();
    expect(transport.lastEventReceivedAt).toBeNull();

    const rawEvent = { id: 'evt-1' };
    ndk.subscriptions[0].emit('event', rawEvent);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(rawEvent);
    expect(transport.lastEventReceivedAt).toEqual(expect.any(Number));
  });
});

describe('decryptEnvelope', () => {
  it('uses the pinned scheme first and reports it on success', async () => {
    const { transport, signer } = startTransport();

    const result = await transport.decryptEnvelope(CLIENT_PUBKEY, 'ciphertext', 'nip44');

    expect(result._unsafeUnwrap()).toEqual({ plaintext: 'plaintext-44', used: 'nip44' });
    expect(signer.nip44Decrypt).toHaveBeenCalledTimes(1);
    expect(signer.nip44Decrypt.mock.calls[0][0].pubkey).toBe(CLIENT_PUBKEY);
    expect(signer.nip44Decrypt.mock.calls[0][1]).toBe('ciphertext');
    expect(signer.nip04Decrypt).not.toHaveBeenCalled();
  });

  it('respects a nip04 pin without touching nip44', async () => {
    const { transport, signer } = startTransport();

    const result = await transport.decryptEnvelope(CLIENT_PUBKEY, 'ciphertext', 'nip04');

    expect(result._unsafeUnwrap()).toEqual({ plaintext: 'plaintext-04', used: 'nip04' });
    expect(signer.nip44Decrypt).not.toHaveBeenCalled();
  });

  it('falls back to the other scheme and reports the one that worked', async () => {
    const { transport, signer } = startTransport();
    signer.nip44Decrypt.mockRejectedValue(new Error('not nip44'));

    const result = await transport.decryptEnvelope(CLIENT_PUBKEY, 'ciphertext', 'nip44');

    expect(result._unsafeUnwrap()).toEqual({ plaintext: 'plaintext-04', used: 'nip04' });
    // Pinned attempt strictly precedes the fallback.
    expect(signer.nip44Decrypt.mock.invocationCallOrder[0]).toBeLessThan(
      signer.nip04Decrypt.mock.invocationCallOrder[0]
    );
  });

  it('errs decrypt-failed when both schemes fail', async () => {
    const { transport, signer } = startTransport();
    signer.nip44Decrypt.mockRejectedValue(new Error('nope'));
    signer.nip04Decrypt.mockRejectedValue(new Error('also nope'));

    const result = await transport.decryptEnvelope(CLIENT_PUBKEY, 'ciphertext', 'nip44');

    expect(result._unsafeUnwrapErr().type).toBe('decrypt-failed');
  });

  it('errs not-started before start', async () => {
    const transport = new Nip46Transport();
    const result = await transport.decryptEnvelope(CLIENT_PUBKEY, 'ciphertext', 'nip44');
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'not-started' });
  });
});

describe('sendResponse', () => {
  it('builds a signed kind-24133 event with a p-tag and publishes to the dedicated pool', async () => {
    const { transport, signer, ndk } = startTransport();

    const result = await transport.sendResponse({
      toPubkey: CLIENT_PUBKEY,
      payloadJson: '{"id":"1","result":"ack"}',
      encryption: 'nip44',
    });

    expect(result.isOk()).toBe(true);
    expect(signer.nip44Encrypt).toHaveBeenCalledTimes(1);
    expect(signer.nip44Encrypt.mock.calls[0][0].pubkey).toBe(CLIENT_PUBKEY);
    expect(signer.nip44Encrypt.mock.calls[0][1]).toBe('{"id":"1","result":"ack"}');

    const relays = [...ndk.pool.relays.values()];
    expect(relays).toHaveLength(2);
    for (const relay of relays) {
      expect(relay.publish).toHaveBeenCalledTimes(1);
      expect(relay.publish.mock.calls[0][1]).toBe(PUBLISH_TIMEOUT_MS);
    }

    const published = relays[0].publish.mock.calls[0][0] as NDKEvent & { sign: jest.Mock };
    expect(published.kind).toBe(NIP46_RPC_KIND);
    expect(published.tags).toEqual([['p', CLIENT_PUBKEY]]);
    expect(published.content).toBe('ciphertext-44');
    expect(published.created_at).toEqual(expect.any(Number));
    expect(published.sign).toHaveBeenCalledWith(asSigner(signer));
    expect(published.ndk).toBe(ndk);

    // Same event instance raced across every relay in the pool.
    expect(relays[1].publish.mock.calls[0][0]).toBe(published);
  });

  it('encrypts with nip04 when the peer is pinned to nip04', async () => {
    const { transport, signer, ndk } = startTransport();

    const result = await transport.sendResponse({
      toPubkey: CLIENT_PUBKEY,
      payloadJson: '{}',
      encryption: 'nip04',
    });

    expect(result.isOk()).toBe(true);
    expect(signer.nip04Encrypt).toHaveBeenCalledTimes(1);
    expect(signer.nip44Encrypt).not.toHaveBeenCalled();
    const relay = [...ndk.pool.relays.values()][0];
    expect((relay.publish.mock.calls[0][0] as NDKEvent).content).toBe('ciphertext-04');
  });

  it('resolves on the first relay accept even when another relay fails', async () => {
    const { transport, ndk } = startTransport();
    const [first, second] = [...ndk.pool.relays.values()];
    first.publish.mockRejectedValue(new Error('relay down'));
    second.publish.mockResolvedValue(true);

    const result = await transport.sendResponse({
      toPubkey: CLIENT_PUBKEY,
      payloadJson: '{}',
      encryption: 'nip44',
    });

    expect(result.isOk()).toBe(true);
  });

  it('errs publish-failed only when every relay rejects', async () => {
    const { transport, ndk } = startTransport();
    for (const relay of ndk.pool.relays.values()) {
      relay.publish.mockRejectedValue(new Error('timeout'));
    }

    const result = await transport.sendResponse({
      toPubkey: CLIENT_PUBKEY,
      payloadJson: '{}',
      encryption: 'nip44',
    });

    expect(result._unsafeUnwrapErr().type).toBe('publish-failed');
  });

  it('errs encrypt-failed when the signer cannot encrypt', async () => {
    const { transport, signer, ndk } = startTransport();
    signer.nip44Encrypt.mockRejectedValue(new Error('bad key'));

    const result = await transport.sendResponse({
      toPubkey: CLIENT_PUBKEY,
      payloadJson: '{}',
      encryption: 'nip44',
    });

    expect(result._unsafeUnwrapErr().type).toBe('encrypt-failed');
    for (const relay of ndk.pool.relays.values()) {
      expect(relay.publish).not.toHaveBeenCalled();
    }
  });

  it('errs not-started before start', async () => {
    const transport = new Nip46Transport();
    const result = await transport.sendResponse({
      toPubkey: CLIENT_PUBKEY,
      payloadJson: '{}',
      encryption: 'nip44',
    });
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'not-started' });
  });
});

describe('rebuild', () => {
  it('swaps the relay set in place: removes stale relays, adds new ones with the auth policy', () => {
    const { transport, ndk } = startTransport();

    const result = transport.rebuild(['wss://nos.lol', 'wss://relay.nsec.app']);

    expect(result.isOk()).toBe(true);
    expect([...ndk.pool.relays.keys()].sort()).toEqual(['wss://nos.lol/', 'wss://relay.nsec.app/']);
    expect(ndk.pool.removeRelay).toHaveBeenCalledWith('wss://relay.damus.io/');
    expect(ndk.pool.relays.get('wss://relay.nsec.app/')?.authPolicy).toBe(
      mocked.__mock.signInPolicy
    );
  });

  it('drops late events from the stopped generation, keeps routing from the new one', () => {
    const { transport, onEvent, ndk } = startTransport();
    const oldSubscription = ndk.subscriptions[0];

    expect(transport.rebuild(['wss://nos.lol']).isOk()).toBe(true);

    expect(oldSubscription.stop).toHaveBeenCalledTimes(1);
    const newSubscription = ndk.subscriptions[1];

    oldSubscription.emit('event', { id: 'late' });
    expect(onEvent).not.toHaveBeenCalled();

    newSubscription.emit('event', { id: 'fresh' });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ id: 'fresh' });
  });

  it('re-subscribes with an overlap-safe since window', () => {
    const nowMs = 1_700_100_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const { transport, ndk } = startTransport();

    expect(transport.rebuild(['wss://nos.lol']).isOk()).toBe(true);

    const since = ndk.subscriptions[1].filters.since;
    expect(since).toBe(Math.floor(nowMs / 1000) - CREATED_AT_SKEW_SEC);
  });

  it('never re-subscribes later than the last received event', () => {
    const eventAtMs = 1_700_100_000_000;
    const laterMs = eventAtMs + 3_600_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(eventAtMs);
    const { transport, ndk } = startTransport();
    ndk.subscriptions[0].emit('event', { id: 'evt' });

    nowSpy.mockReturnValue(laterMs);
    expect(transport.rebuild(['wss://nos.lol']).isOk()).toBe(true);

    expect(ndk.subscriptions[1].filters.since).toBe(Math.floor(eventAtMs / 1000));
  });

  it('errs not-started before start', () => {
    const transport = new Nip46Transport();
    expect(transport.rebuild(['wss://nos.lol'])._unsafeUnwrapErr()).toEqual({
      type: 'not-started',
    });
  });
});

describe('reconnect', () => {
  it('redials every relay and restarts the subscription at its own overlap-safe since', () => {
    const nowMs = 1_700_100_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const { transport, onEvent, ndk } = startTransport();
    const oldSubscription = ndk.subscriptions[0];

    const result = transport.reconnect();

    expect(result.isOk()).toBe(true);
    for (const relay of ndk.pool.relays.values()) {
      expect(relay.connect).toHaveBeenCalledTimes(1);
    }
    expect(oldSubscription.stop).toHaveBeenCalledTimes(1);
    const newSubscription = ndk.subscriptions[1];
    expect(newSubscription.filters.since).toBe(Math.floor(nowMs / 1000) - CREATED_AT_SKEW_SEC);

    oldSubscription.emit('event', { id: 'late' });
    expect(onEvent).not.toHaveBeenCalled();
    newSubscription.emit('event', { id: 'fresh' });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('never re-subscribes later than the last received event', () => {
    const eventAtMs = 1_700_100_000_000;
    const laterMs = eventAtMs + 3_600_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(eventAtMs);
    const { transport, ndk } = startTransport();
    ndk.subscriptions[0].emit('event', { id: 'evt' });

    nowSpy.mockReturnValue(laterMs);
    expect(transport.reconnect().isOk()).toBe(true);

    expect(ndk.subscriptions[1].filters.since).toBe(Math.floor(eventAtMs / 1000));
  });

  it('errs not-started before start', () => {
    const transport = new Nip46Transport();
    expect(transport.reconnect()._unsafeUnwrapErr()).toEqual({ type: 'not-started' });
  });
});

describe('stop', () => {
  it('stops the subscription, disconnects every pool socket, and drops state', () => {
    const { transport, onEvent, ndk } = startTransport();
    const subscription = ndk.subscriptions[0];
    const relays = [...ndk.pool.relays.values()];

    expect(transport.stop().isOk()).toBe(true);

    expect(subscription.stop).toHaveBeenCalledTimes(1);
    for (const relay of relays) {
      expect(relay.disconnect).toHaveBeenCalledTimes(1);
    }
    expect(ndk.pool.relays.size).toBe(0);
    expect(transport.isStarted).toBe(false);

    // Late events after stop are dropped by the generation guard.
    subscription.emit('event', { id: 'late' });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('is idempotent and leaves the transport restartable', () => {
    const { transport } = startTransport();
    expect(transport.stop().isOk()).toBe(true);
    expect(transport.stop().isOk()).toBe(true);

    const restart = transport.start({
      signer: asSigner(makeSigner()),
      userPubkey: USER_PUBKEY,
      relayUrls: ['wss://relay.damus.io'],
      sinceEpochSec: SINCE,
      onEvent: jest.fn(),
    });
    expect(restart.isOk()).toBe(true);
    expect(mocked.__mock.instances.ndks).toHaveLength(2);
  });
});
