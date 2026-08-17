import { parseWireFrame } from '../wire-frame';
import { ok, err, type Result } from 'neverthrow';
import { DEFAULT_TIMEOUT_MS, type RequestControls } from '../../timeout';
import type { NaggError } from '../../errors';
import { nostrLog } from '../../log';

// ---------------------------------------------------------------------------
// Primal cache wire protocol
//
// Primal operates a public cache server that speaks a relay-LIKE WebSocket
// protocol with `cache` verbs. We build only a CLIENT adapter (Primal runs the
// server). A read is one request that streams typed events back and ends on
// EOSE — "stream-collect, resolve-on-EOSE" — so the caller gets one coherent
// batch, never a partial render.
//
//   outbound: ["REQ", subId, { cache: [verb, paramsObject] }]
//   inbound:  ["EVENT", subId, eventObject]  (repeated)
//             ["EOSE",  subId]               (batch complete)
//             ["NOTICE", ...]                (ignored)
//
// The transport sits behind `PrimalConnection` so the demux/tier logic is fully
// testable against a scripted fake — no socket required. Everything received
// here is UNTRUSTED and is Zod-validated downstream before it reaches the cache.
// ---------------------------------------------------------------------------

/** Primal's synthetic + standard kinds we demux. */
export const PRIMAL_KIND = {
  metadata: 0,
  note: 1,
  repost: 6,
  genericRepost: 16,
  zap: 9_735,
  userStats: 10_000_105,
  noteStats: 10_000_100,
  feedRange: 10_000_113,
  noteActions: 10_000_115,
  notification: 10_000_132,
} as const;

export type PrimalCacheRequest = {
  verb: string;
  params: Record<string, unknown>;
};

/** A raw event off the wire — shape NOT yet trusted; validated at demux. */
export type RawPrimalEvent = {
  id?: string;
  pubkey?: string;
  kind: number;
  content?: string;
  tags?: unknown;
  created_at?: number;
};

/**
 * One cache read: send the request, collect events until EOSE, resolve with the
 * full batch. Never throws — failures (network/timeout) fold into the Result.
 */
export interface PrimalConnection {
  request(
    request: PrimalCacheRequest,
    controls?: RequestControls,
  ): Promise<Result<RawPrimalEvent[], NaggError>>;
}

// ---------------------------------------------------------------------------
// Default WebSocket-backed connection
//
// One socket per request (simple + correct; a pooled multiplexed connection is
// a later optimization). Uses the global `WebSocket` — present in React Native,
// Bun, and modern Node — so no transport dependency is added.
// ---------------------------------------------------------------------------

type WebSocketLike = {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
};

export type PrimalWebSocketConfig = {
  /** Primal cache WebSocket URL, e.g. `wss://cache2.primal.net/v1`. */
  url: string;
  /** Inject a WebSocket constructor (tests / non-browser runtimes); defaults to global. */
  WebSocketImpl?: new (url: string) => WebSocketLike;
};

export function createPrimalWebSocketConnection(config: PrimalWebSocketConfig): PrimalConnection {
  const Ctor = config.WebSocketImpl ?? (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  let counter = 0;

  return {
    request(request, controls) {
      if (!Ctor) {
        return Promise.resolve(
          err<RawPrimalEvent[], NaggError>({
            type: 'network',
            message: 'no WebSocket implementation available for the Primal connection',
            cause: undefined,
          }),
        );
      }

      return new Promise<Result<RawPrimalEvent[], NaggError>>((resolve) => {
        const subId = `sov-${++counter}`;
        const events: RawPrimalEvent[] = [];
        let settled = false;
        const startedAt = Date.now();
        nostrLog.debug('nostr.primal.connect', { url: config.url, verb: request.verb, subId });
        const socket = new Ctor(config.url);

        const timeoutMs = controls?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const timer = setTimeout(
          () => finish(err({ type: 'network', message: 'Primal request timed out', cause: undefined })),
          timeoutMs,
        );

        function finish(result: Result<RawPrimalEvent[], NaggError>) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          nostrLog.debug('nostr.primal.finish', {
            subId,
            ok: result.isOk(),
            events: events.length,
            durationMs: Date.now() - startedAt,
          });
          try {
            socket.close();
          } catch {
            // ignore close errors
          }
          resolve(result);
        }

        controls?.signal?.addEventListener('abort', () =>
          finish(err({ type: 'network', message: 'Primal request aborted', cause: undefined })),
        );

        socket.onopen = () => {
          nostrLog.debug('nostr.primal.req', { subId, verb: request.verb });
          socket.send(JSON.stringify(['REQ', subId, { cache: [request.verb, request.params] }]));
        };

        socket.onmessage = (event) => {
          const message = parseWireFrame(event.data);
          if (!message || message[1] !== subId) return;
          if (message[0] === 'EVENT' && message[2] && typeof message[2] === 'object') {
            events.push(message[2] as RawPrimalEvent);
          } else if (message[0] === 'EOSE') {
            nostrLog.debug('nostr.primal.eose', { subId, events: events.length });
            finish(ok(events));
          }
        };

        socket.onerror = () => {
          nostrLog.warn('nostr.primal.error', { subId, url: config.url });
          finish(err({ type: 'network', message: 'Primal socket error', cause: undefined }));
        };

        socket.onclose = () => {
          // Reaching here means EOSE never fired (EOSE calls finish first). A close
          // before EOSE is a TRUNCATED batch, not a complete one — fail so the facade
          // falls through to the relay floor rather than rendering a short page as if
          // it were whole.
          finish(err({ type: 'network', message: 'Primal closed before EOSE', cause: undefined }));
        };
      });
    },
  };
}
