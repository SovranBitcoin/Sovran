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
// One shared socket per cache host; requests on it are told apart by request
// id (`subId`), as on a relay connection. It opens on the first request,
// closes `idleCloseMs` after the last, and is dropped when it errors, closes,
// or stays silent through a request's timeout: every request on it then fails
// over to the next host. A host that failed is not dialled again until a
// jittered backoff has passed (1 s doubling to 60 s); an answer clears it.
//
// Uses the global `WebSocket` (React Native, Bun, modern Node), so no
// transport dependency is added.
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
  /** How long a host's socket stays open with no request on it. Default 15s. */
  idleCloseMs?: number;
  /** Source of the 0..1 backoff jitter (tests pin it). Defaults to `Math.random`. */
  random?: () => number;
};

const HOST_BACKOFF_INITIAL_MS = 1_000;
const HOST_BACKOFF_MAX_MS = 60_000;

type PrimalResult = Result<RawPrimalEvent[], NaggError>;

interface SharedSocket {
  socket: WebSocketLike;
  open: boolean;
  dead: boolean;
  /** Frames delivered, for anyone. A socket that still talks is not dead. */
  frames: number;
  requests: Map<
    string,
    {
      /** Put the REQ on the wire; called once the socket is open. */
      send(): void;
      onFrame(frame: [string, string, unknown?]): void;
      fail(error: NaggError): void;
    }
  >;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function createPrimalWebSocketConnection(config: PrimalWebSocketConfig): PrimalConnection {
  const Ctor = config.WebSocketImpl ?? (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  const urls = (typeof config.url === 'string' ? [config.url] : [...config.url]).filter(
    (url) => url.length > 0,
  );
  const idleCloseMs = config.idleCloseMs ?? 15_000;
  const random = config.random ?? Math.random;
  const sockets = new Map<string, SharedSocket>();
  /** Per host: when it may be dialled again, and the step that set it. */
  const backoff = new Map<string, { until: number; stepMs: number }>();
  let counter = 0;

  function noteHostFailed(url: string): void {
    const stepMs = Math.min((backoff.get(url)?.stepMs ?? HOST_BACKOFF_INITIAL_MS / 2) * 2, HOST_BACKOFF_MAX_MS);
    backoff.set(url, { until: Date.now() + Math.round(stepMs * (0.5 + random() / 2)), stepMs });
  }

  /** The socket is unusable: close it and fail every request still on it. */
  function drop(url: string, shared: SharedSocket, error: NaggError): void {
    if (shared.dead) return;
    shared.dead = true;
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    shared.idleTimer = null;
    if (sockets.get(url) === shared) sockets.delete(url);
    closeWebSocket(shared.socket);
    const requests = [...shared.requests.values()];
    shared.requests.clear();
    for (const request of requests) request.fail(error);
  }

  /** Close without blame: nobody is using it. */
  function retire(url: string, shared: SharedSocket): void {
    if (shared.dead) return;
    shared.dead = true;
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    shared.idleTimer = null;
    if (sockets.get(url) === shared) sockets.delete(url);
    closeWebSocket(shared.socket);
  }

  function closeWhenIdle(url: string, shared: SharedSocket): void {
    if (shared.dead || shared.requests.size > 0 || shared.idleTimer) return;
    if (!shared.open) {
      retire(url, shared);
      return;
    }
    shared.idleTimer = setTimeout(() => {
      shared.idleTimer = null;
      if (shared.requests.size === 0) retire(url, shared);
    }, idleCloseMs);
  }

  function connect(Ctor: new (url: string) => WebSocketLike, url: string): Result<SharedSocket, NaggError> {
    const existing = sockets.get(url);
    if (existing) return ok(existing);
    const opened = openWebSocket(Ctor, url);
    if (opened.isErr()) return err(opened.error);
    const socket = opened.value;
    const shared: SharedSocket = {
      socket,
      open: false,
      dead: false,
      frames: 0,
      requests: new Map(),
      idleTimer: null,
    };
    nostrLog.debug('nostr.primal.connect', { url });
    socket.onopen = () => {
      if (shared.dead) return;
      shared.open = true;
      // Requests that arrived while connecting send themselves now.
      for (const request of [...shared.requests.values()]) request.send();
    };
    socket.onmessage = (event) => {
      if (shared.dead) return;
      shared.frames += 1;
      const message = parseWireFrame(event.data);
      if (!message) return;
      shared.requests.get(message[1])?.onFrame(message);
    };
    socket.onerror = () => {
      nostrLog.warn('nostr.primal.error', { url });
      noteHostFailed(url);
      drop(url, shared, { type: 'network', message: 'Primal socket error', cause: undefined });
    };
    socket.onclose = () => {
      // A close with requests in flight is a TRUNCATED batch for each of them,
      // not a complete one: fail so the facade falls through rather than
      // rendering a short page as if it were whole.
      if (shared.requests.size > 0) noteHostFailed(url);
      drop(url, shared, { type: 'network', message: 'Primal closed before EOSE', cause: undefined });
    };
    sockets.set(url, shared);
    return ok(shared);
  }

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
  ): Promise<PrimalResult> {
    const cooling = backoff.get(url);
    if (cooling && cooling.until > Date.now() && !sockets.has(url)) {
      return Promise.resolve(
        err({ type: 'network', message: 'Primal host backing off after a failure', cause: undefined }),
      );
    }
    const connected = connect(Ctor, url);
    if (connected.isErr()) {
      noteHostFailed(url);
      return Promise.resolve(err(connected.error));
    }
    const shared = connected.value;
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    shared.idleTimer = null;

    return new Promise<PrimalResult>((resolve) => {
      const subId = `sov-${++counter}`;
      const events: RawPrimalEvent[] = [];
      const startedAt = Date.now();
      const framesAtStart = shared.frames;
      let settled = false;
      let sent = false;

      const timeoutMs = controls?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        const timedOut: NaggError = { type: 'network', message: 'Primal request timed out', cause: undefined };
        // Silent for everyone since this request began: the socket is dead.
        if (!shared.dead && shared.frames === framesAtStart) {
          noteHostFailed(url);
          drop(url, shared, timedOut);
          return;
        }
        finish(err(timedOut), true);
      }, timeoutMs);

      function finish(result: PrimalResult, tellHost: boolean) {
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
        if (!shared.dead && shared.requests.delete(subId)) {
          // The host is still working on a request nobody is waiting for.
          if (tellHost && sent && shared.open) sendWebSocket(shared.socket, ['CLOSE', subId]);
          closeWhenIdle(url, shared);
        }
        resolve(result);
      }

      const onAbort = () =>
        finish(
          err({ type: 'network', message: 'Primal request aborted', cause: controls?.signal?.reason }),
          true,
        );
      controls?.signal?.addEventListener('abort', onAbort, { once: true });

      const send = () => {
        if (settled || sent) return;
        sent = true;
        nostrLog.debug('nostr.primal.req', { subId, verb: request.verb });
        const frame = sendWebSocket(shared.socket, ['REQ', subId, { cache: [request.verb, request.params] }]);
        if (frame.isErr()) {
          // A socket that cannot take a frame cannot take anyone's.
          noteHostFailed(url);
          drop(url, shared, frame.error);
        }
      };

      shared.requests.set(subId, {
        send,
        onFrame(message) {
          if (settled) return;
          if (message[0] === 'EVENT') {
            // `kind` is the one field the raw type requires; the rest is checked at demux.
            const frame: { kind?: unknown } | null =
              message[2] && typeof message[2] === 'object' ? message[2] : null;
            if (frame && typeof frame.kind === 'number') events.push(frame as RawPrimalEvent);
          } else if (message[0] === 'EOSE') {
            nostrLog.debug('nostr.primal.eose', { subId, events: events.length });
            backoff.delete(url);
            finish(ok(events), false);
          }
        },
        fail(error) {
          finish(err(error), false);
        },
      });
      if (shared.open) send();
    });
  }
}
