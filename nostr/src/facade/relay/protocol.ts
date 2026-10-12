import type { WebSocketLike } from '../websocket';
import { createRelaySocketPool, type RelaySocketPool } from './socket-pool';
import { ok, err, type Result } from 'neverthrow';
import { DEFAULT_TIMEOUT_MS, type RequestControls } from '../../timeout';
import type { NaggError } from '../../errors';
import { nostrLog } from '../../log';

// ---------------------------------------------------------------------------
// Raw-relay pool protocol (tier 3, the floor)
//
// The honest-decentralisation tier: standard Nostr relays, many operators. We
// speak the plain relay wire protocol (no cache verbs) across a pool, collect a
// COHERENT set, and resolve only once enough relays have signalled EOSE — the
// "coherent set is ready" primitive without a backend. A short settle window
// after the EOSE quorum lets stragglers land so the set doesn't visibly grow
// right after it renders.
//
//   outbound: ["REQ", subId, filter1, filter2, ...]
//   inbound:  ["EVENT", subId, event] (repeated) / ["EOSE", subId]
//
// Everything is UNTRUSTED and validated at the demux. Events are de-duped by id
// across relays. The transport sits behind `RelayConnection` so the demux/tier
// logic is fully testable against fake sockets.
//
// Sockets: one per relay, shared by every request and listener of this
// connection and told apart by subscription id (`socket-pool.ts` has when one
// opens and closes). A request ends its subscription with CLOSE; it does not
// close the socket.
// ---------------------------------------------------------------------------

export type NostrFilter = {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  /** NIP-50 full-text search. Only relays that advertise NIP-50 honour it;
   *  others ignore the field, so a search filter degrades to (no) results. */
  search?: string;
} & { [tag: `#${string}`]: string[] | undefined };

export type RawRelayEvent = {
  id?: string;
  pubkey?: string;
  kind: number;
  content?: string;
  tags?: unknown;
  created_at?: number;
};

/** An EVENT payload with the id and kind every consumer keys on; other fields are coerced in `toFeedEvent`. */
function readRelayEvent(payload: unknown): (RawRelayEvent & { id: string }) | null {
  if (!payload || typeof payload !== 'object') return null;
  const { id, kind }: { id?: unknown; kind?: unknown } = payload;
  if (typeof id !== 'string' || typeof kind !== 'number') return null;
  return { ...payload, id, kind };
}

export interface RelayConnection {
  request(
    filters: NostrFilter[],
    controls?: RequestControls,
  ): Promise<Result<RawRelayEvent[], NaggError>>;
  /**
   * Open a LONG-LIVED subscription: `onEvent` fires per (deduped) event as it
   * arrives; the subscription stays open past EOSE. Returns an unsubscribe. This
   * is the one explicit relay seam — the live listener behind a surface session's
   * "Load new". Optional: a connection that can't stream omits it.
   */
  subscribe?(filters: NostrFilter[], onEvent: (event: RawRelayEvent) => void): () => void;
}

export type RelayPoolConfig = {
  relays: string[];
  WebSocketImpl?: new (url: string) => WebSocketLike;
  /**
   * How many relays must signal EOSE before we consider the coherent set ready.
   * Defaults to a simple majority (so one slow/offline relay can't stall the page).
   */
  eoseQuorum?: number;
  /** Grace window (ms) after the EOSE quorum for stragglers to land. Default 50ms. */
  settleMs?: number;
  /** How long a relay's socket stays open with no subscription on it. Default 5s. */
  idleCloseMs?: number;
  /** Subscriptions one socket carries before another is opened to the same relay. Default 8. */
  maxSubscriptionsPerSocket?: number;
};

export function createRelayPoolConnection(config: RelayPoolConfig): RelayConnection {
  const Ctor =
    config.WebSocketImpl ?? (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  const settleMs = config.settleMs ?? 50;
  let counter = 0;
  const pool: RelaySocketPool | null = Ctor
    ? createRelaySocketPool({
        WebSocketImpl: Ctor,
        idleCloseMs: config.idleCloseMs ?? 5_000,
        maxSubscriptionsPerSocket: config.maxSubscriptionsPerSocket ?? 8,
      })
    : null;

  return {
    request(filters, controls) {
      if (controls?.signal?.aborted) {
        return Promise.resolve(
          err<RawRelayEvent[], NaggError>({
            type: 'network',
            message: 'Relay request aborted',
            cause: controls.signal.reason,
          }),
        );
      }
      const relays = config.relays.filter((r) => r.length > 0);
      if (!pool || relays.length === 0) {
        return Promise.resolve(
          err<RawRelayEvent[], NaggError>({
            type: 'network',
            message: !pool ? 'no WebSocket implementation available' : 'no relays configured',
            cause: undefined,
          }),
        );
      }

      const quorum = Math.max(1, Math.min(config.eoseQuorum ?? Math.ceil(relays.length / 2), relays.length));
      nostrLog.debug('nostr.relay.subscribe', { relays: relays.length, quorum, filters: filters.length });

      return new Promise<Result<RawRelayEvent[], NaggError>>((resolve) => {
        const subId = `sov-${++counter}`;
        const byId = new Map<string, RawRelayEvent>();
        /** Per relay: how to end the subscription, and whether the relay said anything. */
        const subscriptions: { url: string; end: () => void; heard: boolean }[] = [];
        const startedAt = Date.now();
        let eoseCount = 0;
        let closedCount = 0;
        let anyResponded = false;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const timeoutMs = controls?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const hardTimer = setTimeout(() => finish('timeout'), timeoutMs);
        const onAbort = () => finish('done');

        function finish(reason: 'done' | 'timeout' = 'done') {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          controls?.signal?.removeEventListener('abort', onAbort);
          if (settleTimer) clearTimeout(settleTimer);
          for (const subscription of subscriptions) {
            // A relay that was asked and said nothing for the whole timeout is
            // on a socket that may be dead without knowing it: do not reuse it.
            if (reason === 'timeout' && !subscription.heard) pool?.discard(subscription.url, subId);
            subscription.end();
          }
          const events = [...byId.values()];
          if (events.length === 0 && !anyResponded) {
            nostrLog.warn('nostr.relay.failed', { relays: relays.length, durationMs: Date.now() - startedAt });
            resolve(err({ type: 'network', message: 'all relays failed', cause: undefined }));
            return;
          }
          nostrLog.debug('nostr.relay.resolved', {
            events: events.length,
            eoseCount,
            quorum,
            durationMs: Date.now() - startedAt,
          });
          resolve(ok(events));
        }

        function maybeSettle() {
          if (settled || settleTimer) return;
          if (eoseCount >= quorum) {
            settleTimer = setTimeout(() => finish('done'), settleMs);
          }
        }

        controls?.signal?.addEventListener('abort', onAbort, { once: true });

        for (const url of relays) {
          // Each relay's terminal state counts ONCE, or one dead relay would
          // count twice and prematurely drive closedCount past the threshold.
          let terminal = false;
          let receivedEose = false;
          const markClosed = () => {
            if (terminal) return;
            terminal = true;
            closedCount += 1;
            if (closedCount >= relays.length) finish();
          };
          const state = { url, end: () => {}, heard: false };
          const end = pool.subscribe(url, subId, filters, {
            onFrame(message) {
              if (settled) return;
              anyResponded = true;
              state.heard = true;
              if (message[0] === 'EVENT') {
                const raw = readRelayEvent(message[2]);
                if (raw && !byId.has(raw.id)) byId.set(raw.id, raw);
              } else if (message[0] === 'EOSE' && !receivedEose) {
                receivedEose = true;
                eoseCount += 1;
                maybeSettle();
              }
            },
            onClosed: markClosed,
          });
          if (!end) {
            markClosed();
            continue;
          }
          state.end = end;
          subscriptions.push(state);
        }
      });
    },

    subscribe(filters, onEvent) {
      const relays = config.relays.filter((r) => r.length > 0);
      if (!pool || relays.length === 0) return () => {};

      const subId = `sov-live-${++counter}`;
      const seen = new Set<string>();
      const ends: (() => void)[] = [];
      let closed = false;
      nostrLog.debug('nostr.relay.listen', { relays: relays.length, filters: filters.length });

      for (const url of relays) {
        const end = pool.subscribe(url, subId, filters, {
          onFrame(message) {
            // Stay open past EOSE — a live listener only cares about EVENTs.
            if (closed || message[0] !== 'EVENT') return;
            const candidate = readRelayEvent(message[2]);
            if (!candidate || seen.has(candidate.id)) return;
            seen.add(candidate.id);
            onEvent(candidate);
          },
          // A dropped relay simply stops feeding the listener.
          onClosed: () => {},
        });
        if (end) ends.push(end);
      }

      return () => {
        if (closed) return;
        closed = true;
        for (const end of ends) end();
      };
    },
  };
}
