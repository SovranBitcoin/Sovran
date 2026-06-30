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

type WebSocketLike = {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
};

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
};

export function createRelayPoolConnection(config: RelayPoolConfig): RelayConnection {
  const Ctor =
    config.WebSocketImpl ?? (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  const settleMs = config.settleMs ?? 50;
  let counter = 0;

  return {
    request(filters, controls) {
      const relays = config.relays.filter((r) => r.length > 0);
      if (!Ctor || relays.length === 0) {
        return Promise.resolve(
          err<RawRelayEvent[], NaggError>({
            type: 'network',
            message: !Ctor ? 'no WebSocket implementation available' : 'no relays configured',
            cause: undefined,
          }),
        );
      }

      const quorum = Math.max(1, Math.min(config.eoseQuorum ?? Math.ceil(relays.length / 2), relays.length));
      nostrLog.debug('nostr.relay.subscribe', { relays: relays.length, quorum, filters: filters.length });

      return new Promise<Result<RawRelayEvent[], NaggError>>((resolve) => {
        const subId = `sov-${++counter}`;
        const byId = new Map<string, RawRelayEvent>();
        const sockets: WebSocketLike[] = [];
        const startedAt = Date.now();
        let eoseCount = 0;
        let closedCount = 0;
        let anyResponded = false;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const timeoutMs = controls?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const hardTimer = setTimeout(() => finish(), timeoutMs);

        function finish() {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          if (settleTimer) clearTimeout(settleTimer);
          for (const socket of sockets) {
            try {
              socket.close();
            } catch {
              // ignore
            }
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
            settleTimer = setTimeout(finish, settleMs);
          }
        }

        controls?.signal?.addEventListener('abort', () => finish());

        for (const url of relays) {
          const socket = new Ctor(url);
          sockets.push(socket);
          // A real socket fires onerror THEN onclose for the same failure; count
          // each socket's terminal state ONCE, or one dead relay would count twice
          // and prematurely drive closedCount past the threshold.
          let terminal = false;
          const markClosed = () => {
            if (terminal) return;
            terminal = true;
            closedCount += 1;
            if (closedCount >= relays.length) finish();
          };
          socket.onopen = () => {
            socket.send(JSON.stringify(['REQ', subId, ...filters]));
          };
          socket.onmessage = (event) => {
            const message = parseMessage(event.data);
            if (!message || message[1] !== subId) return;
            anyResponded = true;
            if (message[0] === 'EVENT' && message[2] && typeof message[2] === 'object') {
              const raw = message[2] as RawRelayEvent;
              if (typeof raw.id === 'string' && !byId.has(raw.id)) byId.set(raw.id, raw);
            } else if (message[0] === 'EOSE') {
              eoseCount += 1;
              maybeSettle();
            }
          };
          socket.onerror = markClosed;
          socket.onclose = markClosed;
        }
      });
    },

    subscribe(filters, onEvent) {
      const relays = config.relays.filter((r) => r.length > 0);
      if (!Ctor || relays.length === 0) return () => {};

      const subId = `sov-live-${++counter}`;
      const seen = new Set<string>();
      const sockets: WebSocketLike[] = [];
      let closed = false;
      nostrLog.debug('nostr.relay.listen', { relays: relays.length, filters: filters.length });

      for (const url of relays) {
        const socket = new Ctor(url);
        sockets.push(socket);
        socket.onopen = () => {
          if (!closed) socket.send(JSON.stringify(['REQ', subId, ...filters]));
        };
        socket.onmessage = (event) => {
          const message = parseMessage(event.data);
          // Stay open past EOSE — a live listener only cares about EVENTs.
          if (!message || message[1] !== subId || message[0] !== 'EVENT') return;
          const raw = message[2];
          if (!raw || typeof raw !== 'object') return;
          const candidate = raw as RawRelayEvent;
          if (typeof candidate.id !== 'string' || seen.has(candidate.id)) return;
          seen.add(candidate.id);
          onEvent(candidate);
        };
        // onerror/onclose: a dropped relay simply stops feeding the listener.
      }

      return () => {
        if (closed) return;
        closed = true;
        for (const socket of sockets) {
          try {
            socket.send(JSON.stringify(['CLOSE', subId]));
            socket.close();
          } catch {
            // ignore
          }
        }
      };
    },
  };
}

function parseMessage(data: unknown): [string, string, unknown?] | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return parsed as [string, string, unknown?];
    }
  } catch {
    // ignore malformed frames
  }
  return null;
}
