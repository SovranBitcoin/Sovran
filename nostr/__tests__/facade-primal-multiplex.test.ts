import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPrimalWebSocketConnection } from '../src/facade/primal/protocol';

// ---------------------------------------------------------------------------
// D2: one shared Primal cache socket, many requests told apart by request id.
// ---------------------------------------------------------------------------

type Frame = unknown[];

class CacheSocket {
  static instances: CacheSocket[] = [];
  static refuse = new Set<string>();
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: Frame[] = [];
  closed = false;
  constructor(public url: string) {
    CacheSocket.instances.push(this);
    queueMicrotask(() => {
      if (CacheSocket.refuse.has(url)) this.onerror?.({});
      else this.onopen?.({});
    });
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Frame);
  }
  close() {
    this.closed = true;
  }
  emit(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  reqs(): Frame[] {
    return this.sent.filter((f) => f[0] === 'REQ');
  }
  /** Answer one request with a kind-0 naming it, then EOSE. */
  answer(req: Frame) {
    const subId = req[1] as string;
    const [verb, params] = (req[2] as { cache: [string, { tag?: string }] }).cache;
    this.emit(['EVENT', subId, { kind: 0, content: `${verb}:${params.tag ?? ''}` }]);
    this.emit(['EOSE', subId]);
  }
}

const Impl = CacheSocket as unknown as new (url: string) => never;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const opened = (url: string) => CacheSocket.instances.filter((socket) => socket.url === url);

beforeEach(() => {
  vi.useFakeTimers();
  CacheSocket.instances = [];
  CacheSocket.refuse = new Set();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Primal cache connection: one multiplexed socket', () => {
  test('fifty requests at once open one socket and each gets its own answer', async () => {
    const connection = createPrimalWebSocketConnection({ url: 'wss://cache.test', WebSocketImpl: Impl });
    const pending = Array.from({ length: 50 }, (_, index) =>
      connection.request({ verb: 'user_infos', params: { tag: `r${index}` } }),
    );
    await flush();
    expect(CacheSocket.instances).toHaveLength(1);
    const socket = CacheSocket.instances[0]!;
    const reqs = socket.reqs();
    expect(reqs).toHaveLength(50);
    expect(new Set(reqs.map((req) => req[1])).size).toBe(50);
    // Answered out of order: routing is by request id, not arrival.
    for (const req of [...reqs].reverse()) socket.answer(req);
    const results = await Promise.all(pending);
    expect(results.map((result) => result._unsafeUnwrap()[0]!.content)).toEqual(
      Array.from({ length: 50 }, (_, index) => `user_infos:r${index}`),
    );
  });

  test('a later request reuses the open socket; the socket closes once idle and the next request reconnects', async () => {
    const connection = createPrimalWebSocketConnection({
      url: 'wss://cache.test',
      WebSocketImpl: Impl,
      idleCloseMs: 4_000,
    });
    const first = connection.request({ verb: 'user_infos', params: { tag: 'a' } });
    await flush();
    const socket = CacheSocket.instances[0]!;
    socket.answer(socket.reqs()[0]!);
    await first;

    await vi.advanceTimersByTimeAsync(3_000);
    const second = connection.request({ verb: 'user_infos', params: { tag: 'b' } });
    await flush();
    expect(CacheSocket.instances).toHaveLength(1);
    socket.answer(socket.reqs()[1]!);
    expect((await second)._unsafeUnwrap()[0]!.content).toBe('user_infos:b');
    expect(socket.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(socket.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const third = connection.request({ verb: 'user_infos', params: { tag: 'c' } });
    await flush();
    expect(CacheSocket.instances).toHaveLength(2);
    CacheSocket.instances[1]!.answer(CacheSocket.instances[1]!.reqs()[0]!);
    expect((await third).isOk()).toBe(true);
  });

  test('cancelling one request leaves the others on the socket running', async () => {
    const connection = createPrimalWebSocketConnection({ url: 'wss://cache.test', WebSocketImpl: Impl });
    const controller = new AbortController();
    const cancelled = connection.request(
      { verb: 'user_infos', params: { tag: 'gone' } },
      { signal: controller.signal },
    );
    const kept = connection.request({ verb: 'user_infos', params: { tag: 'kept' } });
    await flush();
    const socket = CacheSocket.instances[0]!;
    const [goneReq, keptReq] = socket.reqs();
    controller.abort();
    expect((await cancelled).isErr()).toBe(true);
    expect(socket.sent).toContainEqual(['CLOSE', goneReq![1]]);
    expect(socket.closed).toBe(false);
    socket.answer(keptReq!);
    expect((await kept)._unsafeUnwrap()[0]!.content).toBe('user_infos:kept');
  });

  test('a socket that dies fails every request on it, and each fails over to the next host on one socket', async () => {
    const connection = createPrimalWebSocketConnection({
      url: ['wss://one.test', 'wss://two.test'],
      WebSocketImpl: Impl,
    });
    const pending = Array.from({ length: 5 }, (_, index) =>
      connection.request({ verb: 'user_infos', params: { tag: `r${index}` } }),
    );
    await flush();
    expect(opened('wss://one.test')).toHaveLength(1);
    opened('wss://one.test')[0]!.onclose?.({});
    await flush();
    expect(opened('wss://two.test')).toHaveLength(1);
    const two = opened('wss://two.test')[0]!;
    expect(two.reqs()).toHaveLength(5);
    for (const req of two.reqs()) two.answer(req);
    const results = await Promise.all(pending);
    expect(results.every((result) => result.isOk())).toBe(true);
  });

  test('a host that failed is left alone for a growing, jittered backoff, then tried again', async () => {
    CacheSocket.refuse.add('wss://one.test');
    const connection = createPrimalWebSocketConnection({
      url: ['wss://one.test', 'wss://two.test'],
      WebSocketImpl: Impl,
      random: () => 1,
    });
    const ask = async () => {
      const pending = connection.request({ verb: 'user_infos', params: {} });
      await flush();
      await flush();
      const two = opened('wss://two.test').at(-1)!;
      two.answer(two.reqs().at(-1)!);
      return pending;
    };
    expect((await ask()).isOk()).toBe(true);
    expect(opened('wss://one.test')).toHaveLength(1);

    // Inside the first backoff (1 s) the dead host is not dialled again.
    await vi.advanceTimersByTimeAsync(900);
    expect((await ask()).isOk()).toBe(true);
    expect(opened('wss://one.test')).toHaveLength(1);

    // After it, one more attempt; that failure doubles the wait.
    await vi.advanceTimersByTimeAsync(200);
    expect((await ask()).isOk()).toBe(true);
    expect(opened('wss://one.test')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await ask()).isOk()).toBe(true);
    expect(opened('wss://one.test')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600);
    expect((await ask()).isOk()).toBe(true);
    expect(opened('wss://one.test')).toHaveLength(3);
  });

  test('an answer clears the backoff', async () => {
    CacheSocket.refuse.add('wss://one.test');
    const connection = createPrimalWebSocketConnection({
      url: 'wss://one.test',
      WebSocketImpl: Impl,
      random: () => 1,
    });
    expect((await connection.request({ verb: 'user_infos', params: {} })).isErr()).toBe(true);
    // Cooling down: refused without dialling.
    expect((await connection.request({ verb: 'user_infos', params: {} })).isErr()).toBe(true);
    expect(CacheSocket.instances).toHaveLength(1);

    CacheSocket.refuse.clear();
    await vi.advanceTimersByTimeAsync(1_100);
    const pending = connection.request({ verb: 'user_infos', params: {} });
    await flush();
    CacheSocket.instances[1]!.answer(CacheSocket.instances[1]!.reqs()[0]!);
    expect((await pending).isOk()).toBe(true);
    // A later drop starts again from the first step, not the doubled one.
    CacheSocket.refuse.add('wss://one.test');
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await connection.request({ verb: 'user_infos', params: {} })).isErr()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_100);
    const before = CacheSocket.instances.length;
    await connection.request({ verb: 'user_infos', params: {} });
    expect(CacheSocket.instances.length).toBe(before + 1);
  });

  test('a request that times out on a socket that never spoke drops the socket', async () => {
    const connection = createPrimalWebSocketConnection({ url: 'wss://cache.test', WebSocketImpl: Impl });
    const pending = connection.request({ verb: 'user_infos', params: {} }, { timeoutMs: 1_000 });
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).isErr()).toBe(true);
    expect(CacheSocket.instances[0]!.closed).toBe(true);
  });

  test('a request that times out on a socket still answering others keeps the socket', async () => {
    const connection = createPrimalWebSocketConnection({ url: 'wss://cache.test', WebSocketImpl: Impl });
    const slow = connection.request({ verb: 'user_profile', params: {} }, { timeoutMs: 1_000 });
    const quick = connection.request({ verb: 'user_infos', params: { tag: 'q' } });
    await flush();
    const socket = CacheSocket.instances[0]!;
    socket.answer(socket.reqs()[1]!);
    expect((await quick).isOk()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await slow).isErr()).toBe(true);
    expect(socket.closed).toBe(false);
    expect(socket.sent).toContainEqual(['CLOSE', socket.reqs()[0]![1]]);
  });
});
