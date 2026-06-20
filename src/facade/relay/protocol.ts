import { ok, err, type Result } from 'neverthrow';
import { DEFAULT_TIMEOUT_MS, type RequestControls } from '../../timeout';
import type { NaggError } from '../../errors';

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

      return new Promise<Result<RawRelayEvent[], NaggError>>((resolve) => {
        const subId = `sov-${++counter}`;
        const byId = new Map<string, RawRelayEvent>();
        const sockets: WebSocketLike[] = [];
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
            resolve(err({ type: 'network', message: 'all relays failed', cause: undefined }));
            return;
          }
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
          socket.onerror = () => {
            closedCount += 1;
            if (closedCount >= relays.length) finish();
          };
          socket.onclose = () => {
            closedCount += 1;
            if (closedCount >= relays.length) finish();
          };
        }
      });
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
