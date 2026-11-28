import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';
import { createRelayPoolConnection, type RawRelayEvent } from '../src/facade/relay';

// ---------------------------------------------------------------------------
// D7: the gift-wrap inbox must not cost a Schnorr verification per replayed
// frame. These tests count verifications and read the REQ a reconnect sends.
// ---------------------------------------------------------------------------

type Frame = unknown[];

class InboxSocket {
  static instances: InboxSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: Frame[] = [];
  constructor(public url: string) {
    InboxSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Frame);
  }
  close() {}
  emit(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.onclose?.({});
  }
  req(): Frame {
    const frame = this.sent.find((f) => f[0] === 'REQ');
    if (!frame) throw new Error('no REQ sent');
    return frame;
  }
}

const Impl = InboxSocket as unknown as new (url: string) => never;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function wraps(count: number, createdAt: (index: number) => number) {
  return Array.from({ length: count }, (_, index) =>
    finalizeEvent(
      { kind: 1059, created_at: createdAt(index), tags: [], content: `cipher-${index}` },
      generateSecretKey(),
    ),
  );
}

function countingVerify() {
  const verify = vi.fn((event: Parameters<typeof verifyEvent>[0]) => verifyEvent({ ...event }));
  return verify;
}

const NOW_SEC = 1_800_000_000;
const TWO_DAYS = 2 * 24 * 60 * 60;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_SEC * 1000);
  InboxSocket.instances = [];
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('live gift-wrap subscription', () => {
  test('a wrap replayed by a second relay is dropped by id without a signature check', async () => {
    const verify = countingVerify();
    const connection = createRelayPoolConnection({
      relays: ['wss://a.test', 'wss://b.test'],
      WebSocketImpl: Impl,
      verify,
    });
    const inbox = wraps(5, (i) => NOW_SEC - 100 - i);
    const received: RawRelayEvent[] = [];
    const stop = connection.subscribe!([{ kinds: [1059] }], (ev) => received.push(ev));
    await flush();
    for (const socket of InboxSocket.instances) {
      const subId = socket.req()[1];
      for (const wrap of inbox) socket.emit(['EVENT', subId, wrap]);
    }
    expect(received).toHaveLength(5);
    // Five wraps, two relays: five verifications, not ten.
    expect(verify).toHaveBeenCalledTimes(5);
    stop();
  });

  test('a forged frame is still refused, and does not hide the real wrap that follows it', async () => {
    const verify = countingVerify();
    const connection = createRelayPoolConnection({
      relays: ['wss://a.test'],
      WebSocketImpl: Impl,
      verify,
    });
    const [real] = wraps(1, () => NOW_SEC - 10);
    const forged = { ...real!, content: 'tampered' };
    const received: RawRelayEvent[] = [];
    const stop = connection.subscribe!([{ kinds: [1059] }], (ev) => received.push(ev));
    await flush();
    const socket = InboxSocket.instances[0]!;
    const subId = socket.req()[1];
    socket.emit(['EVENT', subId, forged]);
    expect(received).toHaveLength(0);
    socket.emit(['EVENT', subId, real]);
    expect(received.map((ev) => ev.content)).toEqual([real!.content]);
    // Once the real one is in, a forged copy under its id is a duplicate.
    socket.emit(['EVENT', subId, forged]);
    expect(received).toHaveLength(1);
    stop();
  });

  test('a second subscription on the connection reuses the verdict instead of verifying again', async () => {
    const verify = countingVerify();
    const connection = createRelayPoolConnection({
      relays: ['wss://a.test'],
      WebSocketImpl: Impl,
      verify,
    });
    const inbox = wraps(4, (i) => NOW_SEC - 100 - i);
    const first: RawRelayEvent[] = [];
    const second: RawRelayEvent[] = [];
    const stopFirst = connection.subscribe!([{ kinds: [1059] }], (ev) => first.push(ev));
    const stopSecond = connection.subscribe!([{ kinds: [1059] }], (ev) => second.push(ev));
    await flush();
    const socket = InboxSocket.instances[0]!;
    const subIds = socket.sent.filter((f) => f[0] === 'REQ').map((f) => f[1]);
    expect(subIds).toHaveLength(2);
    for (const subId of subIds) for (const wrap of inbox) socket.emit(['EVENT', subId, wrap]);
    expect(first).toHaveLength(4);
    expect(second).toHaveLength(4);
    expect(verify).toHaveBeenCalledTimes(4);
    stopFirst();
    stopSecond();
  });

  test('a remembered verdict is never extended to different content under the same id', async () => {
    const verify = countingVerify();
    const connection = createRelayPoolConnection({
      relays: ['wss://a.test'],
      WebSocketImpl: Impl,
      verify,
    });
    const [real] = wraps(1, () => NOW_SEC - 10);
    const first: RawRelayEvent[] = [];
    const second: RawRelayEvent[] = [];
    const stopFirst = connection.subscribe!([{ kinds: [1059] }], (ev) => first.push(ev));
    await flush();
    const socket = InboxSocket.instances[0]!;
    socket.emit(['EVENT', socket.req()[1], real]);
    expect(first).toHaveLength(1);
    // A later subscription has not seen the id; the forged body must fail.
    const stopSecond = connection.subscribe!([{ kinds: [1059] }], (ev) => second.push(ev));
    const secondSub = socket.sent.filter((f) => f[0] === 'REQ')[1]![1];
    socket.emit(['EVENT', secondSub, { ...real!, content: 'tampered' }]);
    expect(second).toHaveLength(0);
    socket.emit(['EVENT', secondSub, real]);
    expect(second.map((ev) => ev.content)).toEqual([real!.content]);
    stopFirst();
    stopSecond();
  });

  test('a reconnect asks only for wraps newer than the last one that relay sent, less the overlap', async () => {
    const verify = countingVerify();
    const connection = createRelayPoolConnection({
      relays: ['wss://a.test'],
      WebSocketImpl: Impl,
      verify,
    });
    const newest = NOW_SEC - 500;
    const inbox = wraps(3, (i) => newest - i * 1000);
    const received: RawRelayEvent[] = [];
    const stop = connection.subscribe!([{ kinds: [1059] }], (ev) => received.push(ev), {
      resumeOverlapSec: TWO_DAYS,
    });
    await flush();
    const first = InboxSocket.instances[0]!;
    // The first attach is unbounded: nothing is known about this relay yet.
    expect(first.req()[2]).toEqual({ kinds: [1059] });
    for (const wrap of inbox) first.emit(['EVENT', first.req()[1], wrap]);
    expect(verify).toHaveBeenCalledTimes(3);

    first.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    const second = InboxSocket.instances[1]!;
    expect(second.req()[2]).toEqual({ kinds: [1059], since: newest - TWO_DAYS });
    // The relay replays the window; nothing is verified or delivered twice.
    for (const wrap of inbox) second.emit(['EVENT', second.req()[1], wrap]);
    expect(verify).toHaveBeenCalledTimes(3);
    expect(received).toHaveLength(3);
    stop();
  });

  test('a wrap dated in the future cannot push the resume point past the clock', async () => {
    const connection = createRelayPoolConnection({ relays: ['wss://a.test'], WebSocketImpl: Impl });
    const [future] = wraps(1, () => NOW_SEC + 10 * 365 * 24 * 60 * 60);
    const stop = connection.subscribe!([{ kinds: [1059] }], () => {}, {
      resumeOverlapSec: TWO_DAYS,
    });
    await flush();
    const first = InboxSocket.instances[0]!;
    first.emit(['EVENT', first.req()[1], future]);
    first.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(InboxSocket.instances[1]!.req()[2]).toEqual({
      kinds: [1059],
      since: NOW_SEC - TWO_DAYS,
    });
    stop();
  });

  test('the resume point is per relay: one relay being ahead does not narrow another', async () => {
    const connection = createRelayPoolConnection({
      relays: ['wss://a.test', 'wss://b.test'],
      WebSocketImpl: Impl,
    });
    const [old, recent] = wraps(2, (i) => (i === 0 ? NOW_SEC - 90_000 : NOW_SEC - 10));
    const stop = connection.subscribe!([{ kinds: [1059] }], () => {}, {
      resumeOverlapSec: TWO_DAYS,
    });
    await flush();
    const [a, b] = InboxSocket.instances;
    a!.emit(['EVENT', a!.req()[1], old]);
    b!.emit(['EVENT', b!.req()[1], recent]);
    a!.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    const reattached = InboxSocket.instances[2]!;
    expect(reattached.url).toBe('wss://a.test');
    expect(reattached.req()[2]).toEqual({ kinds: [1059], since: NOW_SEC - 90_000 - TWO_DAYS });
    stop();
  });

  test('without an overlap a reconnect replays unbounded, as before', async () => {
    const connection = createRelayPoolConnection({ relays: ['wss://a.test'], WebSocketImpl: Impl });
    const [wrap] = wraps(1, () => NOW_SEC - 10);
    const stop = connection.subscribe!([{ kinds: [1059] }], () => {});
    await flush();
    const first = InboxSocket.instances[0]!;
    first.emit(['EVENT', first.req()[1], wrap]);
    first.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(InboxSocket.instances[1]!.req()[2]).toEqual({ kinds: [1059] });
    stop();
  });
});

describe('gift-wrap read', () => {
  test('a wrap returned by several relays is verified once', async () => {
    const verify = countingVerify();
    const connection = createRelayPoolConnection({
      relays: ['wss://a.test', 'wss://b.test', 'wss://c.test'],
      WebSocketImpl: Impl,
      settleMs: 0,
      verify,
    });
    const inbox = wraps(6, (i) => NOW_SEC - 100 - i);
    const pending = connection.request([{ kinds: [1059] }]);
    await flush();
    for (const socket of InboxSocket.instances) {
      const subId = socket.req()[1];
      for (const wrap of inbox) socket.emit(['EVENT', subId, wrap]);
      socket.emit(['EOSE', subId]);
    }
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)._unsafeUnwrap()).toHaveLength(6);
    expect(verify).toHaveBeenCalledTimes(6);
  });
});
