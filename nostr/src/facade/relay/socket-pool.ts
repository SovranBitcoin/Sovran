import {
  openWebSocket,
  sendWebSocket,
  closeWebSocket,
  type WebSocketLike,
} from '../websocket';
import { parseWireFrame } from '../wire-frame';

// ---------------------------------------------------------------------------
// One connection per relay, shared by every subscription to it (NIP-01).
//
// A relay expects a client to hold one WebSocket and tell its subscriptions
// apart by subscription id. This pool does that: a subscription asks for a
// relay by URL, the pool opens the socket the first time and reuses it after,
// and frames coming back are routed to the subscription whose id they carry.
//
// Lifetime of a socket:
//
// - It opens when the first subscription asks for its relay.
// - It closes `idleCloseMs` after its last subscription ended. A phone should
//   not hold sockets it is not using, and a burst of reads (a feed page asks
//   several things at once) is what sharing is for.
//   A socket that has not finished connecting when its last subscription ends
//   is closed straight away.
// - It is dropped at once when it errors, closes, refuses a frame, or is
//   reported dead by `discard`. A socket the OS killed while the app was in
//   the background often reports nothing, so a request that timed out without
//   hearing from a relay discards that relay's socket; the next one reconnects.
//
// Relays cap subscriptions per connection (NIP-11 `max_subscriptions`, often
// 10 to 20). Past `maxSubscriptionsPerSocket` the pool opens a further socket
// to the same relay instead of having the relay refuse the subscription.
// ---------------------------------------------------------------------------

export interface PooledSubscription {
  /** A frame carrying this subscription's id: EVENT, EOSE, or CLOSED. */
  onFrame(frame: unknown[]): void;
  /** The socket is gone, or the relay ended the subscription. Called at most once. */
  onClosed(): void;
}

export interface RelaySocketPool {
  /**
   * Subscribe on the relay's shared socket. Returns the way to end the
   * subscription, or null when no socket could be opened. Ending it sends
   * CLOSE and never calls `onClosed`.
   */
  subscribe(
    url: string,
    subId: string,
    filters: readonly unknown[],
    subscription: PooledSubscription,
  ): (() => void) | null;
  /** Drop the socket carrying `subId` on `url`: it was asked and never answered. */
  discard(url: string, subId: string): void;
}

interface PooledSocket {
  socket: WebSocketLike;
  open: boolean;
  dead: boolean;
  subscriptions: Map<string, { filters: readonly unknown[]; handler: PooledSubscription }>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function createRelaySocketPool(config: {
  WebSocketImpl: new (url: string) => WebSocketLike;
  idleCloseMs: number;
  maxSubscriptionsPerSocket: number;
}): RelaySocketPool {
  const socketsByUrl = new Map<string, PooledSocket[]>();

  function forget(url: string, pooled: PooledSocket): void {
    const sockets = socketsByUrl.get(url);
    if (!sockets) return;
    const index = sockets.indexOf(pooled);
    if (index !== -1) sockets.splice(index, 1);
    if (sockets.length === 0) socketsByUrl.delete(url);
  }

  /** The socket is unusable: close it and tell every subscription still on it. */
  function drop(url: string, pooled: PooledSocket): void {
    if (pooled.dead) return;
    pooled.dead = true;
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer);
    pooled.idleTimer = null;
    forget(url, pooled);
    closeWebSocket(pooled.socket);
    const handlers = [...pooled.subscriptions.values()].map((entry) => entry.handler);
    pooled.subscriptions.clear();
    for (const handler of handlers) handler.onClosed();
  }

  function closeWhenIdle(url: string, pooled: PooledSocket): void {
    if (pooled.dead || pooled.subscriptions.size > 0 || pooled.idleTimer) return;
    pooled.idleTimer = setTimeout(() => {
      pooled.idleTimer = null;
      if (pooled.subscriptions.size === 0) drop(url, pooled);
    }, config.idleCloseMs);
  }

  function open(url: string): PooledSocket | null {
    const opened = openWebSocket(config.WebSocketImpl, url);
    if (opened.isErr()) return null;
    const socket = opened.value;
    const pooled: PooledSocket = {
      socket,
      open: false,
      dead: false,
      subscriptions: new Map(),
      idleTimer: null,
    };
    socket.onopen = () => {
      if (pooled.dead) return;
      pooled.open = true;
      for (const [subId, { filters }] of pooled.subscriptions) {
        if (sendWebSocket(socket, ['REQ', subId, ...filters]).isErr()) {
          drop(url, pooled);
          return;
        }
      }
    };
    socket.onmessage = (event) => {
      if (pooled.dead) return;
      const frame = parseWireFrame(event.data);
      if (!frame || typeof frame[1] !== 'string') return;
      const entry = pooled.subscriptions.get(frame[1]);
      if (!entry) return;
      if (frame[0] === 'CLOSED') {
        // The relay ended this subscription (too many, auth required, …). The
        // socket itself is fine for the others.
        pooled.subscriptions.delete(frame[1]);
        entry.handler.onClosed();
        closeWhenIdle(url, pooled);
        return;
      }
      entry.handler.onFrame(frame);
    };
    // A real socket fires onerror THEN onclose for the same failure; `drop`
    // runs once.
    socket.onerror = () => drop(url, pooled);
    socket.onclose = () => drop(url, pooled);
    const sockets = socketsByUrl.get(url);
    if (sockets) sockets.push(pooled);
    else socketsByUrl.set(url, [pooled]);
    return pooled;
  }

  return {
    subscribe(url, subId, filters, subscription) {
      const pooled =
        socketsByUrl
          .get(url)
          ?.find((each) => each.subscriptions.size < config.maxSubscriptionsPerSocket) ?? open(url);
      if (!pooled) return null;
      if (pooled.idleTimer) clearTimeout(pooled.idleTimer);
      pooled.idleTimer = null;
      pooled.subscriptions.set(subId, { filters, handler: subscription });
      if (pooled.open && sendWebSocket(pooled.socket, ['REQ', subId, ...filters]).isErr()) {
        // Told through `onClosed`, like any other loss of the socket, but not
        // before the caller has the return value.
        queueMicrotask(() => drop(url, pooled));
      }
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        if (pooled.dead || !pooled.subscriptions.delete(subId)) return;
        if (!pooled.open) {
          // The relay was never sent this subscription, so there is nothing to
          // CLOSE. A socket still connecting with nobody waiting on it is not
          // worth keeping.
          if (pooled.subscriptions.size === 0) drop(url, pooled);
          return;
        }
        // A socket that cannot take CLOSE cannot take anything else either.
        if (sendWebSocket(pooled.socket, ['CLOSE', subId]).isErr()) drop(url, pooled);
        else closeWhenIdle(url, pooled);
      };
    },
    discard(url, subId) {
      const pooled = socketsByUrl.get(url)?.find((each) => each.subscriptions.has(subId));
      if (pooled) drop(url, pooled);
    },
  };
}
