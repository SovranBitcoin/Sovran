/**
 * @fileoverview The BTC price WebSocket, owned outside React.
 *
 * Two things the previous inline effect got wrong, both of which this shape
 * exists to make impossible:
 *
 * 1. It never gave up gracefully — it gave up PERMANENTLY. Five failed
 *    attempts on a 1/2/4/8/16s ladder is 31 seconds; a launch inside a tunnel,
 *    a lift, or a hotel captive portal burned all five and the feed was dead
 *    for the rest of the session. Nothing re-armed it: no foreground hook, no
 *    connectivity hook. Every fiat figure in the app then sat on the last
 *    persisted price, flagged stale after five minutes. `resume()` is the way
 *    back — the ladder is a burst limit now, not a death sentence.
 *
 * 2. Its cleanup leaked a socket. `ws.close()` only asks the native side to
 *    close, so `onclose` fires AFTER the cleanup returns — and `onclose`
 *    scheduled a reconnect that the already-completed cleanup could not clear.
 *    The unmounted provider therefore re-opened a socket a second later, with
 *    nothing owning it. `PricelistProvider` sits inside `AccountScopedProviders`
 *    (remounted on every profile switch by design) and inside `CocoProvider`
 *    (which renders `null` while a manager is initialising), so that unmount is
 *    routine, not exotic: one orphan socket per profile switch, each still
 *    writing into the global price store.
 *
 * Kept framework-agnostic and injectable so the ladder, the cancellation and
 * the resume path are testable without a real socket — none of which was
 * reachable while this lived in a `useEffect` closure.
 */
import { PricelistWsMessage, loggableIssues, parseWith } from '@sovranbitcoin/schemas';

import { log } from '@/shared/lib/logger';
import type { BitcoinPrices } from '@/shared/stores/global/pricelistStore';

const PRICELIST_URL = 'wss://ws.sovran.money';

/** Consecutive failures before the fast ladder gives way to the slow retry. */
export const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
/**
 * The ladder's floor. After five fast attempts the feed keeps trying at this
 * interval rather than stopping: `resume()` covers a device that went offline
 * and came back, but not `ws.sovran.money` itself being down for 31 seconds
 * while the device is online and the app stays foregrounded — nothing would
 * ever fire, and the feed would be dead for the session again.
 */
export const IDLE_RETRY_MS = 5 * 60 * 1000;
/**
 * A socket can read OPEN and deliver nothing — a blackholed TCP connection
 * after a Doze or a network handoff. Android disables OkHttp's read timeout
 * for web sockets and this feed is receive-only, so nothing else would ever
 * notice. Matched to `pricelistStore.isStale(5)`: past this, what the socket
 * holds is no better than no socket.
 */
export const SILENT_SOCKET_MS = 5 * 60 * 1000;

const parsePricelistWs = parseWith(PricelistWsMessage, 'pricelist.ws');

/** The slice of `WebSocket` this feed uses. */
export interface PricelistSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  onclose: (() => void) | null;
  close: () => void;
}

interface PricelistFeedOptions {
  onPrices: (prices: BitcoinPrices) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
  /** Injectable for tests; defaults to the platform `WebSocket`. */
  createSocket?: (url: string) => PricelistSocket;
  url?: string;
}

export interface PricelistFeed {
  /** Open the socket. Safe to call twice; the second is a no-op. */
  start: () => void;
  /**
   * Re-arm after the ladder paused, or redial a socket the OS dropped while
   * backgrounded. No-op on a live connection and after `stop()`.
   */
  resume: (reason: 'foreground' | 'online') => void;
  /** Close for good. Nothing this feed scheduled runs afterwards. */
  stop: () => void;
}

const SOCKET_OPEN = 1;
const SOCKET_CONNECTING = 0;

export function createPricelistFeed(options: PricelistFeedOptions): PricelistFeed {
  const { onPrices, onLoading, onError } = options;
  const url = options.url ?? PRICELIST_URL;
  const createSocket =
    options.createSocket ??
    ((target: string) => new WebSocket(target) as unknown as PricelistSocket);

  let socket: PricelistSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let stopped = false;
  let lastFrameAt: number | null = null;

  /**
   * Let go of a socket we no longer own.
   *
   * Detaching the handlers is not enough on Android: `WebSocketModule` records
   * a socket in its map only inside `onOpen`, and `close()` on an id it does
   * not hold returns without doing anything — so closing a dial still in
   * CONNECTING is a native no-op there, and the OkHttp connection would go on
   * to open and stay open with nothing owning it. Hence the one handler left
   * attached: if it does open, close it then.
   */
  const discard = (target: PricelistSocket) => {
    target.onmessage = null;
    target.onerror = null;
    target.onclose = null;
    target.onopen = () => {
      target.onopen = null;
      target.close();
    };
    target.close();
  };

  const clearPendingReconnect = () => {
    if (reconnectTimeout === null) return;
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  };

  const connect = () => {
    if (stopped) return;
    // CONNECTING counts as live. Guarding on OPEN alone would abandon a dial
    // already in flight and leave two sockets racing to write prices.
    if (socket?.readyState === SOCKET_OPEN || socket?.readyState === SOCKET_CONNECTING) return;

    log.info('pricelist.ws.connecting', { attempt: attempts });
    onLoading(true);
    onError(null);

    let opened: PricelistSocket;
    try {
      opened = createSocket(url);
    } catch (err) {
      // A synchronous constructor failure now enters the ladder like any other
      // failure. It used to be terminal — one error message and no retry ever.
      log.error('pricelist.ws.create_failed', { error: err });
      onError('Failed to connect to price feed');
      onLoading(false);
      scheduleReconnect();
      return;
    }
    socket = opened;

    opened.onopen = () => {
      if (stopped) return;
      log.info('pricelist.ws.connected');
      onLoading(false);
      onError(null);
      attempts = 0;
      // Start the silence clock at connect, so a socket that opens and then
      // says nothing is still recognisable as dead.
      lastFrameAt = Date.now();
    };

    opened.onmessage = (event) => {
      if (stopped) return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch (err) {
        log.error('pricelist.ws.json_error', { error: err });
        return; // Keep socket open; ignore malformed frame.
      }
      const parsed = parsePricelistWs(raw);
      if (parsed.isErr()) {
        log.warn('pricelist.ws.parse_rejected', { issues: loggableIssues(parsed.error) });
        // Drop unknown-shape frames silently — price UI keeps its last-valid
        // value rather than surfacing an error.
        return;
      }
      lastFrameAt = Date.now();
      onPrices(parsed.value.btcPrices as BitcoinPrices);
    };

    opened.onerror = (err) => {
      if (stopped) return;
      log.error('pricelist.ws.error', { error: err });
      onError('Connection error');
      onLoading(false);
    };

    opened.onclose = () => {
      // The guard the old cleanup could not have: `close()` is a request to
      // the native side, so this runs after the effect teardown returned.
      if (stopped) return;
      log.info('pricelist.ws.closed');
      onLoading(false);
      scheduleReconnect();
    };
  };

  // Both callers (`onclose`, and `connect`'s create-failure path) already
  // return on `stopped`, so this needs only the in-flight-timer guard — a
  // second `stopped` check here would be a branch no test could reach.
  const scheduleReconnect = () => {
    if (reconnectTimeout !== null) return;
    const exhausted = attempts >= MAX_RECONNECT_ATTEMPTS;
    if (exhausted) {
      log.error('pricelist.ws.max_reconnects');
      onError('Connection lost. Please check your internet connection.');
    } else {
      attempts += 1;
    }
    const delay = exhausted ? IDLE_RETRY_MS : RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts - 1);
    log.info('pricelist.ws.reconnecting', {
      attempt: attempts,
      max: MAX_RECONNECT_ATTEMPTS,
      delay,
      idle: exhausted,
    });
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connect();
    }, delay);
  };

  return {
    start: connect,

    resume: (reason) => {
      if (stopped) return;
      const silentFor = lastFrameAt === null ? 0 : Date.now() - lastFrameAt;
      if (socket?.readyState === SOCKET_OPEN && silentFor < SILENT_SOCKET_MS) return;
      log.info('pricelist.ws.resume', { reason, attempts, silentFor });
      attempts = 0;
      clearPendingReconnect();
      // Let go of whatever is there rather than waiting behind it — a dial
      // still in CONNECTING (RN's WebSocket has no connect timeout, and
      // `connect()` treats CONNECTING as live, so the resume meant to recover
      // the feed would be the thing blocking it) or a socket that reads OPEN
      // and has gone quiet.
      const stale = socket;
      socket = null;
      lastFrameAt = null;
      if (stale) discard(stale);
      connect();
    },

    stop: () => {
      stopped = true;
      clearPendingReconnect();
      const closing = socket;
      socket = null;
      if (closing) discard(closing);
    },
  };
}
