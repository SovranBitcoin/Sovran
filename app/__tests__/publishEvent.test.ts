/**
 * Unit tests for the central publish seam, over a fake `NostrClient` whose
 * relays accept or refuse each publish as the test says.
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { NostrClient, UnsignedNostrEvent } from 'nostr/client';
import type { VerifiedEvent } from 'nostr-tools/pure';

import { publishEvent } from '@/shared/lib/nostr/publish';
import { asVerified } from './helpers/fakeNostrClient';

type FakeRelay = { url: string; publish: jest.Mock };

function relay(url: string, impl: () => Promise<boolean>): FakeRelay {
  return { url, publish: jest.fn(impl) };
}

/** A client whose pool is `relays`; a url names a relay with or without its trailing slash. */
function fakeClient(relays: FakeRelay[], signer: unknown = {}): NostrClient {
  const find = (url: string) => relays.find((r) => r.url === url.replace(/\/$/, ''));
  return {
    signer,
    relayUrls: () => relays.map((r) => r.url),
    signEvent: (template: UnsignedNostrEvent) =>
      (signer as { sign: (t: UnsignedNostrEvent) => VerifiedEvent }).sign(template),
    publishToRelay: async (url: string) => {
      const target = find(url);
      if (!target) throw new Error(`not in pool: ${url}`);
      await target.publish();
    },
  } as unknown as NostrClient;
}

function signedEvent(id = 'evt1'): VerifiedEvent {
  return asVerified({
    id,
    kind: 7,
    sig: 'sig',
    pubkey: 'p',
    created_at: 1,
    tags: [],
    content: '',
  });
}

const accept = () => Promise.resolve(true);
const reject =
  (msg = 'boom') =>
  () =>
    Promise.reject(new Error(msg));

const fastRetry = { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 };

describe('publishEvent', () => {
  it('returns ok with all relays accepted', async () => {
    const client = fakeClient([relay('wss://a', accept), relay('wss://b', accept)]);
    const res = await publishEvent({ client, event: signedEvent(), retry: fastRetry });

    expect(res.isOk()).toBe(true);
    const value = res._unsafeUnwrap();
    expect(value.anyAccepted).toBe(true);
    expect(value.accepted).toHaveLength(2);
    expect(value.failed).toHaveLength(0);
    expect(value.eventId).toBe('evt1');
  });

  it('retries only the failed relay, then succeeds', async () => {
    let bCalls = 0;
    const b = relay('wss://b', () => {
      bCalls += 1;
      return bCalls >= 2 ? Promise.resolve(true) : Promise.reject(new Error('temp'));
    });
    const a = relay('wss://a', accept);
    const client = fakeClient([a, b]);

    const res = await publishEvent({ client, event: signedEvent(), retry: fastRetry });

    expect(res.isOk()).toBe(true);
    expect(a.publish).toHaveBeenCalledTimes(1); // accepted first round, never retried
    expect(b.publish).toHaveBeenCalledTimes(2); // failed then retried
    expect(res._unsafeUnwrap().accepted.map((r) => r.url)).toEqual(
      expect.arrayContaining(['wss://a', 'wss://b'])
    );
  });

  it('errors all-failed after exhausting retries', async () => {
    const a = relay('wss://a', reject('nope'));
    const client = fakeClient([a]);

    const res = await publishEvent({ client, event: signedEvent(), retry: fastRetry });

    expect(res.isErr()).toBe(true);
    const error = res._unsafeUnwrapErr();
    expect(error.type).toBe('all-failed');
    expect(a.publish).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('first-ok short-circuits without retrying the failing relay', async () => {
    const good = relay('wss://good', accept);
    const bad = relay('wss://bad', reject());
    const client = fakeClient([good, bad]);

    const res = await publishEvent({
      client,
      event: signedEvent(),
      resolveOn: 'first-ok',
      retry: fastRetry,
    });

    expect(res.isOk()).toBe(true);
    expect(bad.publish).toHaveBeenCalledTimes(1); // not retried once one relay accepted
  });

  it('classifies a timeout failure', async () => {
    const a = relay('wss://a', reject('Publish timed out'));
    const client = fakeClient([a]);

    const res = await publishEvent({ client, event: signedEvent(), retry: fastRetry });
    const error = res._unsafeUnwrapErr();
    expect(error.type).toBe('all-failed');
    if (error.type === 'all-failed') {
      const failure = error.relayResults[0];
      expect(failure.ok).toBe(false);
      if (!failure.ok) expect(failure.reason).toBe('timeout');
    }
  });

  it('errors no-signer when an unsigned event has no signer', async () => {
    const client = fakeClient([relay('wss://a', accept)], null);
    const unsigned: UnsignedNostrEvent = { kind: 1, tags: [], content: '' };

    const res = await publishEvent({ client, event: unsigned, retry: fastRetry });
    expect(res._unsafeUnwrapErr().type).toBe('no-signer');
  });

  it('errors sign-failed when signing throws', async () => {
    const client = fakeClient([relay('wss://a', accept)], {
      sign: () => {
        throw new Error('keystore locked');
      },
    });
    const unsigned: UnsignedNostrEvent = { kind: 1, tags: [], content: '' };

    const res = await publishEvent({ client, event: unsigned, retry: fastRetry });
    expect(res._unsafeUnwrapErr().type).toBe('sign-failed');
  });

  it('errors no-relays when the pool is empty and no relays are given', async () => {
    const client = fakeClient([]);
    const res = await publishEvent({ client, event: signedEvent(), retry: fastRetry });
    expect(res._unsafeUnwrapErr().type).toBe('no-relays');
  });

  it('single-flights concurrent publishes of the same event id', async () => {
    const a = relay('wss://a', accept);
    const client = fakeClient([a]);
    const event = signedEvent('dup');

    const [r1, r2] = await Promise.all([
      publishEvent({ client, event, retry: fastRetry }),
      publishEvent({ client, event, retry: fastRetry }),
    ]);

    expect(r1.isOk()).toBe(true);
    expect(r2.isOk()).toBe(true);
    expect(a.publish).toHaveBeenCalledTimes(1); // deduped
  });

  it('streams terminal per-relay results to onRelayResult', async () => {
    const client = fakeClient([relay('wss://a', accept), relay('wss://b', reject())]);
    const seen: string[] = [];

    await publishEvent({
      client,
      event: signedEvent(),
      retry: { attempts: 0, baseDelayMs: 0, maxDelayMs: 0 },
      onRelayResult: (r) => seen.push(`${r.url}:${r.ok}`),
    });

    expect(seen).toEqual(expect.arrayContaining(['wss://a:true', 'wss://b:false']));
  });
});

/** Drains background fan-out work (microtasks + zero-delay backoff timers). */
const flushBackground = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe('publishEvent optimistic mode', () => {
  it('resolves ok on the first accept, then retries failed base relays in the background', async () => {
    let badCalls = 0;
    const good = relay('wss://good', accept);
    const bad = relay('wss://bad', () => {
      badCalls += 1;
      return badCalls >= 2 ? Promise.resolve(true) : Promise.reject(new Error('temp'));
    });
    const client = fakeClient([good, bad]);

    const res = await publishEvent({
      client,
      event: signedEvent('opt1'),
      relays: ['wss://good', 'wss://bad'],
      resolveOn: 'optimistic',
      retry: fastRetry,
    });

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().anyAccepted).toBe(true);

    await flushBackground();
    expect(bad.publish).toHaveBeenCalledTimes(2); // failed round retried in the background
  });

  it('fails fast with no background retries when the first round accepts nowhere', async () => {
    const bad = relay('wss://bad', reject('down'));
    const client = fakeClient([bad]);

    const res = await publishEvent({
      client,
      event: signedEvent('opt2'),
      relays: ['wss://bad'],
      resolveOn: 'optimistic',
      retry: fastRetry,
    });

    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe('all-failed');

    await flushBackground();
    // No zombie retries: the user keeps the draft and may resubmit.
    expect(bad.publish).toHaveBeenCalledTimes(1);
  });

  it('fans out to background recipient relays once the post is assured', async () => {
    const own = relay('wss://own', accept);
    const recipient = relay('wss://recipient', accept);
    const client = fakeClient([own, recipient]);

    const res = await publishEvent({
      client,
      event: signedEvent('opt3'),
      relays: ['wss://own'],
      backgroundRelays: Promise.resolve(['wss://recipient']),
      resolveOn: 'optimistic',
      retry: fastRetry,
    });

    expect(res.isOk()).toBe(true);
    expect(own.publish).toHaveBeenCalledTimes(1);

    await flushBackground();
    expect(recipient.publish).toHaveBeenCalledTimes(1); // reached off the critical path
  });

  it('settles with an error (never hangs) when relay resolution throws', async () => {
    const client = fakeClient([relay('wss://x', accept)]);

    // If `assured` failed to settle this `await` would hang and time out.
    const res = await publishEvent({
      client,
      event: signedEvent('throw1'),
      get relays(): string[] {
        throw new Error('relay set boom');
      },
      resolveOn: 'optimistic',
      retry: fastRetry,
    });

    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe('all-failed');
  });

  it('skips background recipient relays when the post failed', async () => {
    const own = relay('wss://own', reject('down'));
    const recipient = relay('wss://recipient', accept);
    const client = fakeClient([own, recipient]);

    const res = await publishEvent({
      client,
      event: signedEvent('opt4'),
      relays: ['wss://own'],
      backgroundRelays: Promise.resolve(['wss://recipient']),
      resolveOn: 'optimistic',
      retry: fastRetry,
    });

    expect(res.isErr()).toBe(true);
    await flushBackground();
    expect(recipient.publish).not.toHaveBeenCalled();
  });
});
