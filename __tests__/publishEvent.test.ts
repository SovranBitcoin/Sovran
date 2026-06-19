/**
 * Unit tests for the central publish seam. The real @nostr-dev-kit/ndk-mobile
 * pulls native bits, so it is mocked down to the symbols publishEvent imports;
 * the relays-omitted path drives a fully fake `ndk.pool`.
 */
/* eslint-disable import/first */

// virtual: ndk-mobile ships ESM-only exports jest-expo cannot resolve.
jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: class NDK {},
    NDKEvent: class NDKEvent {},
    NDKRelaySet: { fromRelayUrls: jest.fn() },
    normalizeRelayUrl: (url: string) => url,
  }),
  { virtual: true }
);

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type NDK from '@nostr-dev-kit/ndk-mobile';
import type { NDKEvent } from '@nostr-dev-kit/ndk-mobile';

import { publishEvent } from '@/shared/lib/nostr/publish';

type FakeRelay = { url: string; publish: jest.Mock };

function relay(url: string, impl: () => Promise<boolean>): FakeRelay {
  return { url, publish: jest.fn(impl) };
}

function fakeNdk(relays: FakeRelay[], signer: unknown = {}): NDK {
  return {
    signer,
    pool: { relays: new Map(relays.map((r) => [r.url, r])) },
  } as unknown as NDK;
}

function signedEvent(id = 'evt1'): NDKEvent {
  return { id, kind: 7, sig: 'sig', sign: jest.fn() } as unknown as NDKEvent;
}

const accept = () => Promise.resolve(true);
const reject =
  (msg = 'boom') =>
  () =>
    Promise.reject(new Error(msg));

const fastRetry = { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 };

describe('publishEvent', () => {
  it('returns ok with all relays accepted', async () => {
    const ndk = fakeNdk([relay('wss://a', accept), relay('wss://b', accept)]);
    const res = await publishEvent({ ndk, event: signedEvent(), retry: fastRetry });

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
    const ndk = fakeNdk([a, b]);

    const res = await publishEvent({ ndk, event: signedEvent(), retry: fastRetry });

    expect(res.isOk()).toBe(true);
    expect(a.publish).toHaveBeenCalledTimes(1); // accepted first round, never retried
    expect(b.publish).toHaveBeenCalledTimes(2); // failed then retried
    expect(res._unsafeUnwrap().accepted.map((r) => r.url)).toEqual(
      expect.arrayContaining(['wss://a', 'wss://b'])
    );
  });

  it('errors all-failed after exhausting retries', async () => {
    const a = relay('wss://a', reject('nope'));
    const ndk = fakeNdk([a]);

    const res = await publishEvent({ ndk, event: signedEvent(), retry: fastRetry });

    expect(res.isErr()).toBe(true);
    const error = res._unsafeUnwrapErr();
    expect(error.type).toBe('all-failed');
    expect(a.publish).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('first-ok short-circuits without retrying the failing relay', async () => {
    const good = relay('wss://good', accept);
    const bad = relay('wss://bad', reject());
    const ndk = fakeNdk([good, bad]);

    const res = await publishEvent({
      ndk,
      event: signedEvent(),
      resolveOn: 'first-ok',
      retry: fastRetry,
    });

    expect(res.isOk()).toBe(true);
    expect(bad.publish).toHaveBeenCalledTimes(1); // not retried once one relay accepted
  });

  it('classifies a timeout failure', async () => {
    const a = relay('wss://a', reject('Publish timed out'));
    const ndk = fakeNdk([a]);

    const res = await publishEvent({ ndk, event: signedEvent(), retry: fastRetry });
    const error = res._unsafeUnwrapErr();
    expect(error.type).toBe('all-failed');
    if (error.type === 'all-failed') {
      const failure = error.relayResults[0];
      expect(failure.ok).toBe(false);
      if (!failure.ok) expect(failure.reason).toBe('timeout');
    }
  });

  it('errors no-signer when an unsigned event has no signer', async () => {
    const ndk = fakeNdk([relay('wss://a', accept)], null);
    const unsigned = { id: 'x', kind: 1, sig: undefined, sign: jest.fn() } as unknown as NDKEvent;

    const res = await publishEvent({ ndk, event: unsigned, retry: fastRetry });
    expect(res._unsafeUnwrapErr().type).toBe('no-signer');
  });

  it('errors sign-failed when signing throws', async () => {
    const ndk = fakeNdk([relay('wss://a', accept)], {});
    const unsigned = {
      id: 'x',
      kind: 1,
      sig: undefined,
      sign: jest.fn(() => Promise.reject(new Error('keystore locked'))),
    } as unknown as NDKEvent;

    const res = await publishEvent({ ndk, event: unsigned, retry: fastRetry });
    expect(res._unsafeUnwrapErr().type).toBe('sign-failed');
  });

  it('errors no-relays when the pool is empty and no relays are given', async () => {
    const ndk = fakeNdk([]);
    const res = await publishEvent({ ndk, event: signedEvent(), retry: fastRetry });
    expect(res._unsafeUnwrapErr().type).toBe('no-relays');
  });

  it('single-flights concurrent publishes of the same event id', async () => {
    const a = relay('wss://a', accept);
    const ndk = fakeNdk([a]);
    const event = signedEvent('dup');

    const [r1, r2] = await Promise.all([
      publishEvent({ ndk, event, retry: fastRetry }),
      publishEvent({ ndk, event, retry: fastRetry }),
    ]);

    expect(r1.isOk()).toBe(true);
    expect(r2.isOk()).toBe(true);
    expect(a.publish).toHaveBeenCalledTimes(1); // deduped
  });

  it('streams terminal per-relay results to onRelayResult', async () => {
    const ndk = fakeNdk([relay('wss://a', accept), relay('wss://b', reject())]);
    const seen: string[] = [];

    await publishEvent({
      ndk,
      event: signedEvent(),
      retry: { attempts: 0, baseDelayMs: 0, maxDelayMs: 0 },
      onRelayResult: (r) => seen.push(`${r.url}:${r.ok}`),
    });

    expect(seen).toEqual(expect.arrayContaining(['wss://a:true', 'wss://b:false']));
  });
});
