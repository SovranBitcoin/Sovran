import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPrimalWebSocketConnection } from "../src/facade/primal/protocol";
import { createRelayPoolConnection } from "../src/facade/relay/protocol";
import type { RequestControls } from "../src/timeout";

class Socket {
  static instances: Socket[] = [];
  static failConstruction = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(readonly url: string) {
    if (Socket.failConstruction) throw new Error("invalid socket URL");
    Socket.instances.push(this);
  }
  message(frame: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const requests = {
  primal: (controls: RequestControls) =>
    createPrimalWebSocketConnection({
      url: "wss://cache.example",
      WebSocketImpl: Socket,
    }).request({ verb: "feed", params: {} }, controls),
  relay: (controls: RequestControls) =>
    createRelayPoolConnection({
      relays: ["wss://relay.example"],
      WebSocketImpl: Socket,
      settleMs: 0,
    }).request([{ kinds: [1] }], controls),
};

beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  Socket.failConstruction = false;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(Object.entries(requests))(
  "%s request lifetime",
  (_name, request) => {
    test("constructor failures resolve as Results without leaving a timer", async () => {
      Socket.failConstruction = true;
      expect((await request({})).isErr()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    test("completion releases the caller signal and ignores late socket callbacks", async () => {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const pending = request({ signal: controller.signal });
      const socket = Socket.instances[0];
      socket.onopen?.({});
      const lateMessage = socket.onmessage;
      socket.message(["EOSE", "sov-1"]);
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;
      expect(result._unsafeUnwrap()).toEqual([]);
      lateMessage?.({
        data: JSON.stringify(["EVENT", "sov-1", { id: "late", kind: 1 }]),
      });
      expect(result._unsafeUnwrap()).toEqual([]);
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
      // A relay's socket is shared between requests and closes once it has
      // been idle; a per-request socket (Primal) is closed already.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(socket.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    test("an EVENT frame without a numeric kind is dropped, not typed as an event", async () => {
      const pending = request({});
      const socket = Socket.instances[0];
      socket.onopen?.({});
      socket.message(["EVENT", "sov-1", { id: "no-kind", pubkey: "p" }]);
      socket.message([
        "EVENT",
        "sov-1",
        { id: "text-kind", pubkey: "p", kind: "1" },
      ]);
      socket.message(["EVENT", "sov-1", { id: "note", pubkey: "p", kind: 1 }]);
      socket.message(["EOSE", "sov-1"]);
      await vi.advanceTimersByTimeAsync(0);
      expect((await pending)._unsafeUnwrap()).toEqual([
        { id: "note", pubkey: "p", kind: 1 },
      ]);
    });

    test("an already cancelled request opens no socket", async () => {
      const controller = new AbortController();
      controller.abort();
      const pending = request({ signal: controller.signal });
      expect(Socket.instances).toHaveLength(0);
      expect((await pending).isErr()).toBe(true);
    });
  },
);

describe("relay pool lifecycle", () => {
  test("a relay contributes at most one vote to the EOSE quorum", async () => {
    const connection = createRelayPoolConnection({
      relays: ["wss://one.example", "wss://two.example"],
      WebSocketImpl: Socket,
      eoseQuorum: 2,
      settleMs: 5,
    });
    const pending = connection.request([{ kinds: [1] }]);
    const [one, two] = Socket.instances;
    one.message(["EOSE", "sov-1"]);
    one.message(["EOSE", "sov-1"]);
    await vi.advanceTimersByTimeAsync(5);
    expect(one.close).not.toHaveBeenCalled();
    two.message(["EVENT", "sov-1", { id: "second-relay", kind: 1 }]);
    two.message(["EOSE", "sov-1"]);
    await vi.advanceTimersByTimeAsync(5);
    expect((await pending)._unsafeUnwrap()).toEqual([
      { id: "second-relay", kind: 1 },
    ]);
  });

  test("unsubscribe closes even when CLOSE cannot be sent, and ignores queued events", () => {
    const connection = createRelayPoolConnection({
      relays: ["wss://one.example"],
      WebSocketImpl: Socket,
    });
    const onEvent = vi.fn();
    const unsubscribe = connection.subscribe!([{ kinds: [1] }], onEvent);
    const socket = Socket.instances[0];
    const lateMessage = socket.onmessage;
    socket.send.mockImplementation(() => {
      throw new Error("still connecting");
    });
    unsubscribe();
    unsubscribe();
    expect(socket.close).toHaveBeenCalledTimes(1);
    lateMessage?.({
      data: JSON.stringify(["EVENT", "sov-live-1", { id: "late", kind: 1 }]),
    });
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("one socket per relay", () => {
  const sent = (socket: Socket) =>
    socket.send.mock.calls.map(([frame]) => JSON.parse(frame as string) as unknown[]);
  const pool = (overrides: { maxSubscriptionsPerSocket?: number } = {}) =>
    createRelayPoolConnection({
      relays: ["wss://relay.example"],
      WebSocketImpl: Socket,
      settleMs: 0,
      ...overrides,
    });

  test("two requests at once share the socket and are told apart by subscription id", async () => {
    const connection = pool();
    const first = connection.request([{ kinds: [1] }]);
    const second = connection.request([{ kinds: [0] }]);
    expect(Socket.instances).toHaveLength(1);
    const socket = Socket.instances[0];
    socket.onopen?.({});
    expect(sent(socket)).toEqual([
      ["REQ", "sov-1", { kinds: [1] }],
      ["REQ", "sov-2", { kinds: [0] }],
    ]);

    socket.message(["EVENT", "sov-2", { id: "profile", kind: 0 }]);
    socket.message(["EVENT", "sov-1", { id: "note", kind: 1 }]);
    socket.message(["EOSE", "sov-1"]);
    socket.message(["EOSE", "sov-2"]);
    await vi.advanceTimersByTimeAsync(0);

    expect((await first)._unsafeUnwrap()).toEqual([{ id: "note", kind: 1 }]);
    expect((await second)._unsafeUnwrap()).toEqual([{ id: "profile", kind: 0 }]);
    // Each ends its own subscription; neither closes the socket under the other.
    expect(sent(socket).slice(2)).toEqual([
      ["CLOSE", "sov-1"],
      ["CLOSE", "sov-2"],
    ]);
    expect(socket.close).not.toHaveBeenCalled();
  });

  test("a later request reuses the open socket, and the socket closes once idle", async () => {
    const connection = pool();
    const first = connection.request([{ kinds: [1] }]);
    const socket = Socket.instances[0];
    socket.onopen?.({});
    socket.message(["EOSE", "sov-1"]);
    await vi.advanceTimersByTimeAsync(0);
    await first;

    await vi.advanceTimersByTimeAsync(4_000);
    const second = connection.request([{ kinds: [1] }]);
    expect(Socket.instances).toHaveLength(1);
    // Already open: asked at once, without waiting for another onopen.
    expect(sent(socket).at(-1)).toEqual(["REQ", "sov-2", { kinds: [1] }]);
    socket.message(["EOSE", "sov-2"]);
    await vi.advanceTimersByTimeAsync(0);
    await second;

    await vi.advanceTimersByTimeAsync(4_999);
    expect(socket.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.close).toHaveBeenCalledTimes(1);

    void connection.request([{ kinds: [1] }]);
    expect(Socket.instances).toHaveLength(2);
  });

  test("opens another socket to the relay past the subscriptions one socket carries", () => {
    const connection = pool({ maxSubscriptionsPerSocket: 2 });
    for (let n = 0; n < 5; n++) void connection.request([{ kinds: [1] }]);
    expect(Socket.instances).toHaveLength(3);
  });

  test("a subscription the relay ends with CLOSED counts as that relay gone, and spares the socket", async () => {
    const connection = pool();
    const refused = connection.request([{ kinds: [1] }]);
    const other = connection.request([{ kinds: [0] }]);
    const socket = Socket.instances[0];
    socket.onopen?.({});
    socket.message(["CLOSED", "sov-1", "rate-limited: too many subscriptions"]);
    expect((await refused).isErr()).toBe(true);

    socket.message(["EVENT", "sov-2", { id: "profile", kind: 0 }]);
    socket.message(["EOSE", "sov-2"]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await other)._unsafeUnwrap()).toEqual([{ id: "profile", kind: 0 }]);
    expect(socket.close).not.toHaveBeenCalled();
  });

  test("a socket that dies ends every request on it, and the next request reconnects", async () => {
    const connection = pool();
    const first = connection.request([{ kinds: [1] }]);
    const second = connection.request([{ kinds: [0] }]);
    const socket = Socket.instances[0];
    socket.onopen?.({});
    socket.onerror?.({});
    socket.onclose?.({});
    expect((await first).isErr()).toBe(true);
    expect((await second).isErr()).toBe(true);

    void connection.request([{ kinds: [1] }]);
    expect(Socket.instances).toHaveLength(2);
  });

  test("a relay that never answers within the timeout loses its socket", async () => {
    const connection = pool();
    const silent = connection.request([{ kinds: [1] }], { timeoutMs: 1_000 });
    const socket = Socket.instances[0];
    socket.onopen?.({});
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await silent).isErr()).toBe(true);
    // Killed sockets often report nothing: it is not kept for the next request.
    expect(socket.close).toHaveBeenCalledTimes(1);

    void connection.request([{ kinds: [1] }]);
    expect(Socket.instances).toHaveLength(2);
  });

  test("a relay that answered and then ran out the timeout keeps its socket", async () => {
    const connection = pool();
    const slow = connection.request([{ kinds: [1] }], { timeoutMs: 1_000 });
    const socket = Socket.instances[0];
    socket.onopen?.({});
    socket.message(["EVENT", "sov-1", { id: "note", kind: 1 }]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await slow)._unsafeUnwrap()).toEqual([{ id: "note", kind: 1 }]);
    expect(socket.close).not.toHaveBeenCalled();
  });

  test("a listener and a request share the socket; ending the listener leaves the request running", async () => {
    const connection = pool();
    const onEvent = vi.fn();
    const stop = connection.subscribe!([{ kinds: [1] }], onEvent);
    const pending = connection.request([{ kinds: [0] }]);
    expect(Socket.instances).toHaveLength(1);
    const socket = Socket.instances[0];
    socket.onopen?.({});
    socket.message(["EVENT", "sov-live-1", { id: "live", kind: 1 }]);
    expect(onEvent).toHaveBeenCalledWith({ id: "live", kind: 1 });

    stop();
    expect(sent(socket).at(-1)).toEqual(["CLOSE", "sov-live-1"]);
    expect(socket.close).not.toHaveBeenCalled();
    socket.message(["EOSE", "sov-2"]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending)._unsafeUnwrap()).toEqual([]);
  });
});
