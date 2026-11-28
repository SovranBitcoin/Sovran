import { getEventHash, verifyEvent } from 'nostr-tools/pure';
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

const GIFT_WRAP_KIND = 1059;
const LIVE_RECONNECT_INITIAL_MS = 1_000;
const LIVE_RECONNECT_MAX_MS = 30_000;
/** Verdicts remembered per connection: an id and a signature, about 200 bytes each. */
const MAX_REMEMBERED_VERDICTS = 5_000;

type SignatureCheck = (event: Parameters<typeof verifyEvent>[0]) => boolean;

/**
 * Gift-wrap signature check that pays for the Schnorr verification once per
 * event per connection. A remembered verdict is reused only for the same
 * bytes: the same signature, and fields that still hash to the id. A frame
 * borrowing a verified id for other content is verified in full, and fails.
 */
function createGiftWrapVerifier(verify: SignatureCheck): (payload: object, id: string) => boolean {
  const verdicts = new Map<string, string>();
  return (payload, id) => {
    const event = payload as Parameters<typeof verifyEvent>[0];
    const known = verdicts.get(id);
    if (known !== undefined && known === event.sig && hashesTo(event, id)) return true;
    if (!verify(event)) return false;
    verdicts.set(id, event.sig);
    if (verdicts.size > MAX_REMEMBERED_VERDICTS) {
      const oldest = verdicts.keys().next().value;
      if (oldest !== undefined) verdicts.delete(oldest);
    }
    return true;
  };
}

function hashesTo(event: Parameters<typeof getEventHash>[0], id: string): boolean {
  try {
    return getEventHash(event) === id;
  } catch {
    // Not serialisable as an event: let the full check refuse it.
    return false;
  }
}

/**
 * An EVENT payload with the id and kind every consumer keys on; other fields are coerced in `toFeedEvent`.
 * `isDuplicate` runs BEFORE the signature check: an id enters a seen set only
 * after its event verified, so a replayed id costs nothing, and a forged frame
 * under an unseen id still fails and cannot hide the real event after it.
 */
function readRelayEvent(
  payload: unknown,
  isDuplicate: (id: string) => boolean,
  verifyGiftWrap: (payload: object, id: string) => boolean,
): (RawRelayEvent & { id: string }) | null {
  if (!payload || typeof payload !== 'object') return null;
  const { id, kind }: { id?: unknown; kind?: unknown } = payload;
  if (typeof id !== 'string' || typeof kind !== 'number') return null;
  if (isDuplicate(id)) return null;
  if (kind === GIFT_WRAP_KIND && !verifyGiftWrap(payload, id)) return null;
  return { ...payload, id, kind };
}

/** What a live subscription may be told about how to come back after a drop. */
export type RelaySubscribeOptions = {
  /**
   * Re-attach to a relay with `since` = the newest `created_at` that relay has
   * sent here, less this many seconds, instead of replaying everything. The
   * first attach is never narrowed. The mark is per relay and capped at the
   * local clock. For NIP-59 gift wraps the overlap must cover two days.
   */
  resumeOverlapSec?: number;
};

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
  subscribe?(
    filters: NostrFilter[],
    onEvent: (event: RawRelayEvent) => void,
    options?: RelaySubscribeOptions,
  ): () => void;
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
  /** Signature check for gift wraps (tests count calls). Defaults to nostr-tools' `verifyEvent`. */
  verify?: SignatureCheck;
  /** Source of the 0..1 reconnect jitter (tests pin it). Defaults to `Math.random`. */
  random?: () => number;
};

export function createRelayPoolConnection(config: RelayPoolConfig): RelayConnection {
  const Ctor =
    config.WebSocketImpl ?? (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  const settleMs = config.settleMs ?? 50;
  const verifyGiftWrap = createGiftWrapVerifier(config.verify ?? verifyEvent);
  const random = config.random ?? Math.random;
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
                const raw = readRelayEvent(message[2], (id) => byId.has(id), verifyGiftWrap);
                if (raw) byId.set(raw.id, raw);
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

    subscribe(filters, onEvent, options) {
      const relays = config.relays.filter((r) => r.length > 0);
      if (!pool || relays.length === 0) return () => {};

      const seen = new Set<string>();
      const activeEnds = new Map<string, () => void>();
      const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const reconnectDelays = new Map<string, number>();
      /** Per relay: the newest `created_at` it has sent here, capped at the clock. */
      const newestFrom = new Map<string, number>();
      const resumeOverlapSec = options?.resumeOverlapSec;
      let closed = false;
      nostrLog.debug('nostr.relay.listen', { relays: relays.length, filters: filters.length });

      /** Exponential backoff with jitter, so relays that dropped together do not return together. */
      const scheduleReattach = (url: string) => {
        if (closed || reconnectTimers.has(url)) return;
        const delay = reconnectDelays.get(url) ?? LIVE_RECONNECT_INITIAL_MS;
        reconnectDelays.set(url, Math.min(delay * 2, LIVE_RECONNECT_MAX_MS));
        const timer = setTimeout(
          () => {
            reconnectTimers.delete(url);
            attach(url);
          },
          Math.round(delay * (0.5 + random() / 2)),
        );
        reconnectTimers.set(url, timer);
      };

      const filtersFor = (url: string): NostrFilter[] => {
        const newest = newestFrom.get(url);
        if (resumeOverlapSec === undefined || newest === undefined) return filters;
        const since = newest - resumeOverlapSec;
        // Two filters, OR-ed by the relay: the stored events of the window,
        // and (`limit: 0`, no stored events) everything that ARRIVES from now
        // on whatever its date, as the unbounded subscription received.
        return filters.flatMap((filter) => [
          { ...filter, since: Math.max(filter.since ?? 0, since) },
          { ...filter, limit: 0 },
        ]);
      };

      const attach = (url: string) => {
        if (closed) return;
        const subId = `sov-live-${++counter}`;
        const end = pool.subscribe(url, subId, filtersFor(url), {
          onFrame(message) {
            if (closed) return;
            // Healthy traffic resets the reconnect backoff for this relay.
            reconnectDelays.delete(url);
            // Stay open past EOSE — a live listener only cares about EVENTs.
            if (message[0] !== 'EVENT') return;
            noteCreatedAt(url, message[2]);
            const candidate = readRelayEvent(message[2], (id) => seen.has(id), verifyGiftWrap);
            if (!candidate) return;
            seen.add(candidate.id);
            onEvent(candidate);
          },
          onClosed: () => {
            activeEnds.delete(url);
            scheduleReattach(url);
          },
        });
        if (end) activeEnds.set(url, end);
        else scheduleReattach(url);
      };

      /** Advance this relay's resume point, duplicates included: it is how far THIS relay has been heard. */
      const noteCreatedAt = (url: string, payload: unknown) => {
        if (resumeOverlapSec === undefined || !payload || typeof payload !== 'object') return;
        const { created_at: createdAt }: { created_at?: unknown } = payload;
        if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return;
        const capped = Math.min(createdAt, Math.floor(Date.now() / 1000));
        if (capped > (newestFrom.get(url) ?? -Infinity)) newestFrom.set(url, capped);
      };

      for (const url of relays) attach(url);

      return () => {
        if (closed) return;
        closed = true;
        for (const timer of reconnectTimers.values()) clearTimeout(timer);
        reconnectTimers.clear();
        for (const end of activeEnds.values()) end();
        activeEnds.clear();
      };
    },
  };
}
