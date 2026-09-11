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
      expect(socket.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
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
