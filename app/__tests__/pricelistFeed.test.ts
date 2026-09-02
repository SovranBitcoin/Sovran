/**
 * @jest-environment node
 */
import {
  createPricelistFeed,
  IDLE_RETRY_MS,
  MAX_RECONNECT_ATTEMPTS,
  SILENT_SOCKET_MS,
  type PricelistSocket,
} from '@/shared/lib/pricelistFeed';

jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class FakeSocket implements PricelistSocket {
  readyState = CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  closeCalls = 0;

  close(): void {
    this.closeCalls += 1;
    this.readyState = CLOSED;
    // `close()` only asks the native side to close; the event lands later.
    // Every test that models a teardown fires `onclose` by hand afterwards,
    // which is the ordering that produced the orphan socket.
  }

  open(): void {
    this.readyState = OPEN;
    this.onopen?.();
  }

  drop(): void {
    this.readyState = CLOSED;
    this.onclose?.();
  }
}

function makeFeed() {
  const sockets: FakeSocket[] = [];
  const onPrices = jest.fn();
  const onLoading = jest.fn();
  const onError = jest.fn();
  const feed = createPricelistFeed({
    onPrices,
    onLoading,
    onError,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { feed, sockets, onPrices, onLoading, onError };
}

/** Walk the whole backoff ladder to its pause, dropping each dial. */
function exhaustLadder(sockets: FakeSocket[]) {
  sockets[sockets.length - 1].drop();
  for (let i = 1; i < MAX_RECONNECT_ATTEMPTS; i++) {
    jest.runOnlyPendingTimers();
    sockets[sockets.length - 1].drop();
  }
  jest.runOnlyPendingTimers();
  sockets[sockets.length - 1].drop();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('pricelist feed', () => {
  it('opens one socket and keeps it on a malformed frame', () => {
    const { feed, sockets, onPrices, onError } = makeFeed();
    feed.start();
    expect(sockets).toHaveLength(1);
    sockets[0].open();

    sockets[0].onmessage?.({ data: 'not json' });
    sockets[0].onmessage?.({ data: JSON.stringify({ nope: true }) });
    expect(onPrices).not.toHaveBeenCalled();
    expect(sockets[0].closeCalls).toBe(0);

    sockets[0].onmessage?.({
      data: JSON.stringify({ btcPrices: { USD: 42, GBP: 33, EUR: 39 } }),
    });
    expect(onPrices).toHaveBeenCalledWith({ USD: 42, GBP: 33, EUR: 39 });
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('does not dial a second socket while the first is still connecting', () => {
    const { feed, sockets } = makeFeed();
    feed.start();
    feed.start();
    expect(sockets).toHaveLength(1);
  });

  it('leaves nothing behind after stop, even though onclose lands late', () => {
    // The bug: cleanup ran `clearTimeout` and then `ws.close()`. `close()` is a
    // request to the native side, so `onclose` fired after the cleanup had
    // already returned and scheduled a reconnect nothing could cancel — one
    // orphan socket per unmount, and this provider is remounted on every
    // profile switch.
    const { feed, sockets, onLoading } = makeFeed();
    feed.start();
    sockets[0].open();

    onLoading.mockClear();
    feed.stop();
    expect(sockets[0].closeCalls).toBe(1);
    sockets[0].onclose?.();
    jest.runOnlyPendingTimers();

    expect(sockets).toHaveLength(1);
    // And the dead feed writes nothing back into the store on its way out.
    expect(onLoading).not.toHaveBeenCalled();
  });

  it('ignores a frame that arrives after stop', () => {
    const { feed, sockets, onPrices } = makeFeed();
    feed.start();
    sockets[0].open();
    feed.stop();

    sockets[0].onmessage?.({
      data: JSON.stringify({ btcPrices: { USD: 42, GBP: 33, EUR: 39 } }),
    });
    expect(onPrices).not.toHaveBeenCalled();
  });

  it('climbs the fast ladder, then keeps trying slowly instead of giving up', () => {
    const { feed, sockets, onError } = makeFeed();
    feed.start();
    exhaustLadder(sockets);

    expect(sockets).toHaveLength(MAX_RECONNECT_ATTEMPTS + 1);
    expect(onError).toHaveBeenLastCalledWith(
      'Connection lost. Please check your internet connection.'
    );

    // The old code stopped here for the rest of the session. It must not dial
    // on the fast ladder's cadence any more…
    jest.advanceTimersByTime(IDLE_RETRY_MS - 1);
    expect(sockets).toHaveLength(MAX_RECONNECT_ATTEMPTS + 1);
    // …but it must still be trying. `resume()` covers a device that went
    // offline and came back; this covers the price service alone being down
    // while the device is online and the app never leaves the foreground.
    jest.advanceTimersByTime(1);
    expect(sockets).toHaveLength(MAX_RECONNECT_ATTEMPTS + 2);
  });

  it.each(['foreground', 'online'] as const)('re-arms the paused ladder on %s', (reason) => {
    const { feed, sockets } = makeFeed();
    feed.start();
    exhaustLadder(sockets);
    const exhausted = sockets.length;

    feed.resume(reason);
    expect(sockets).toHaveLength(exhausted + 1);

    // And the ladder is a full ladder again, not one last attempt.
    sockets[sockets.length - 1].drop();
    jest.runOnlyPendingTimers();
    expect(sockets).toHaveLength(exhausted + 2);
  });

  it('abandons a dial still hanging in CONNECTING when resumed', () => {
    // RN's WebSocket has no connect timeout. A dial started while the network
    // was down can sit in CONNECTING for as long as the platform's TCP
    // timeout, and `connect()` treats CONNECTING as live — so without this the
    // resume meant to recover the feed would queue behind the hang.
    const { feed, sockets } = makeFeed();
    feed.start();
    expect(sockets[0].readyState).toBe(CONNECTING);

    feed.resume('online');
    expect(sockets).toHaveLength(2);
    expect(sockets[0].closeCalls).toBe(1);

    // And the abandoned socket cannot schedule anything on top of the new one.
    sockets[0].onclose?.();
    jest.runOnlyPendingTimers();
    expect(sockets).toHaveLength(2);
  });

  it('closes a discarded dial that opens later, which Android needs', () => {
    // `WebSocketModule` records a socket only in `onOpen`, and `close()` on an
    // id it does not hold does nothing — so closing a CONNECTING dial is a
    // native no-op there and the connection would open unowned.
    const { feed, sockets } = makeFeed();
    feed.start();
    feed.resume('online');
    expect(sockets).toHaveLength(2);

    const abandoned = sockets[0];
    expect(abandoned.closeCalls).toBe(1);
    abandoned.onopen?.();
    expect(abandoned.closeCalls).toBe(2);
  });

  it('replaces a socket that reads OPEN but has gone silent', () => {
    // Android disables OkHttp's read timeout for web sockets and this feed is
    // receive-only, so a blackholed connection reads OPEN forever.
    const { feed, sockets } = makeFeed();
    feed.start();
    sockets[0].open();

    jest.advanceTimersByTime(SILENT_SOCKET_MS);
    feed.resume('foreground');
    expect(sockets).toHaveLength(2);
  });

  it('does not redial a live socket on resume', () => {
    const { feed, sockets } = makeFeed();
    feed.start();
    sockets[0].open();
    sockets[0].onmessage?.({
      data: JSON.stringify({ btcPrices: { USD: 1, GBP: 1, EUR: 1 } }),
    });

    feed.resume('foreground');
    expect(sockets).toHaveLength(1);
  });

  it('stays stopped when resumed after stop', () => {
    const { feed, sockets } = makeFeed();
    feed.start();
    feed.stop();

    feed.resume('foreground');
    jest.runOnlyPendingTimers();
    expect(sockets).toHaveLength(1);
  });
});
