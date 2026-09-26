import {
  openWebSocket,
  sendWebSocket,
  closeWebSocket,
  type WebSocketLike,
} from '../websocket';
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

export type PrimalWebSocketConfig = {
  /**
   * Primal cache WebSocket URL, or several tried in order.
   *
   * Primal runs more than one cache host and they do not fail together —
   * `cache2.primal.net` serving an EXPIRED TLS CERTIFICATE while `cache1`
   * answered normally is what prompted this. That failure mode matters: it is
   * not a refused connection that a health check trivially spots, it is a
   * handshake the platform rejects, and it persists for as long as nobody at
   * Primal renews the certificate. A list is exhausted before the caller sees
   * an error, so the facade only falls through to the raw-relay floor when NO
   * cache answered, rather than when the first one happened to be down.
   */
  url: string | readonly string[];
  /** Inject a WebSocket constructor (tests / non-browser runtimes); defaults to global. */
  WebSocketImpl?: new (url: string) => WebSocketLike;
};

export function createPrimalWebSocketConnection(config: PrimalWebSocketConfig): PrimalConnection {
  const Ctor = config.WebSocketImpl ?? (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  const urls = (typeof config.url === 'string' ? [config.url] : [...config.url]).filter(
    (url) => url.length > 0,
  );
  let counter = 0;

  return {
    async request(request, controls) {
      if (controls?.signal?.aborted) {
        return err<RawPrimalEvent[], NaggError>({
          type: 'network',
          message: 'Primal request aborted',
          cause: controls.signal.reason,
        });
      }
      if (!Ctor) {
        return err<RawPrimalEvent[], NaggError>({
          type: 'network',
          message: 'no WebSocket implementation available for the Primal connection',
          cause: undefined,
        });
      }
      if (urls.length === 0) {
        return err<RawPrimalEvent[], NaggError>({
          type: 'network',
          message: 'no Primal cache url configured',
          cause: undefined,
        });
      }

      let lastError: NaggError | null = null;
      for (const [index, url] of urls.entries()) {
        // An abort between hosts stops the walk: the caller is gone, and trying
        // the next one would spend a socket on a result nobody reads.
        if (controls?.signal?.aborted) {
          return err<RawPrimalEvent[], NaggError>({
            type: 'network',
            message: 'Primal request aborted',
            cause: controls.signal.reason,
          });
        }
        const attempt = await requestOnce(Ctor, url, request, controls);
        if (attempt.isOk()) {
          if (index > 0) {
            nostrLog.info('nostr.primal.host.failover', {
              url,
              attempt: index + 1,
              of: urls.length,
            });
          }
          return attempt;
        }
        lastError = attempt.error;
        nostrLog.warn('nostr.primal.host.unavailable', {
          url,
          attempt: index + 1,
          of: urls.length,
          message: attempt.error.message,
        });
      }
      // Every host failed, so the facade should fall through to the relay floor.
      return err<RawPrimalEvent[], NaggError>(
        lastError ?? { type: 'network', message: 'Primal request failed', cause: undefined },
      );
    },
  };

  function requestOnce(
    Ctor: new (url: string) => WebSocketLike,
    url: string,
    request: PrimalCacheRequest,
    controls: RequestControls | undefined,
  ): Promise<Result<RawPrimalEvent[], NaggError>> {
      return new Promise<Result<RawPrimalEvent[], NaggError>>((resolve) => {
        const subId = `sov-${++counter}`;
        const events: RawPrimalEvent[] = [];
        let settled = false;
        const startedAt = Date.now();
        nostrLog.debug('nostr.primal.connect', { url, verb: request.verb, subId });
        const opened = openWebSocket(Ctor, url);
        if (opened.isErr()) {
          resolve(err(opened.error));
          return;
        }
        const socket = opened.value;

        const timeoutMs = controls?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const timer = setTimeout(
          () => finish(err({ type: 'network', message: 'Primal request timed out', cause: undefined })),
          timeoutMs,
        );

        function finish(result: Result<RawPrimalEvent[], NaggError>) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          controls?.signal?.removeEventListener('abort', onAbort);
          nostrLog.debug('nostr.primal.finish', {
            subId,
            ok: result.isOk(),
            events: events.length,
            durationMs: Date.now() - startedAt,
          });
          closeWebSocket(socket);
          resolve(result);
        }

        const onAbort = () =>
          finish(err({ type: 'network', message: 'Primal request aborted', cause: controls?.signal?.reason }));
        controls?.signal?.addEventListener('abort', onAbort, { once: true });

        socket.onopen = () => {
          if (settled) return;
          nostrLog.debug('nostr.primal.req', { subId, verb: request.verb });
          const sent = sendWebSocket(socket, ['REQ', subId, { cache: [request.verb, request.params] }]);
          if (sent.isErr()) finish(err(sent.error));
        };

        socket.onmessage = (event) => {
          if (settled) return;
          const message = parseWireFrame(event.data);
          if (!message || message[1] !== subId) return;
          if (message[0] === 'EVENT') {
            // `kind` is the one field the raw type requires; the rest is checked at demux.
            const frame: { kind?: unknown } | null =
              message[2] && typeof message[2] === 'object' ? message[2] : null;
            if (frame && typeof frame.kind === 'number') events.push(frame as RawPrimalEvent);
          } else if (message[0] === 'EOSE') {
            nostrLog.debug('nostr.primal.eose', { subId, events: events.length });
            finish(ok(events));
          }
        };

        socket.onerror = () => {
          nostrLog.warn('nostr.primal.error', { subId, url });
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
  }
}
