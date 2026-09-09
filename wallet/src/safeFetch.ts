// ---------------------------------------------------------------------------
// safeFetch — timeout + AbortSignal wrapper for external-server calls
//
// React Native / browser `fetch` has no default timeout. A request that
// never settles wedges the caller's await indefinitely (iOS often waits
// minutes before the OS reaps the socket). Every external-server call in
// this package — LNURL pay-params, LNURL invoice callback, Nostr relay
// publish — must be bounded.
//
// This helper combines a caller-supplied AbortSignal with a per-request
// timeout signal so whichever fires first wins. Aborts surface as Errors
// whose `name` is `AbortError` or `TimeoutError`; callers identify them
// via `isAbortError` rather than `instanceof DOMException`, since Hermes
// does not ship `DOMException`.
// ---------------------------------------------------------------------------

import { errField, logger } from "./logger";

/**
 * Default per-request budget. Tuned for the slowest reasonable LNURL /
 * Nostr-relay round-trip on cellular; configurable per-call via
 * `RequestControls.timeoutMs`.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestControls {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function summarizeUrl(rawUrl: string): Record<string, unknown> {
  try {
    const url = new URL(rawUrl);
    return {
      protocol: url.protocol,
      host: url.host,
      pathLength: url.pathname.length,
      hasQuery: url.search.length > 0,
    };
  } catch {
    return { urlLength: rawUrl.length, parseable: false };
  }
}

/**
 * Combine an arbitrary number of signals into one. The result aborts when
 * any input aborts. Hand-rolled because `AbortSignal.any` is not yet on
 * every Hermes build the wallet ships against; the listener pattern works
 * everywhere `AbortController` does.
 */
export function combineSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal {
  const controller = new AbortController();
  const sources = [...new Set(signals.filter((signal): signal is AbortSignal => !!signal))];
  const aborted = sources.find((signal) => signal.aborted);
  if (aborted) {
    controller.abort(aborted.reason);
    return controller.signal;
  }
  const listeners = new Map<AbortSignal, () => void>();
  for (const signal of sources) {
    const onAbort = () => {
      // Release the losing sources too: callers may outlive many deadlines.
      for (const [source, listener] of listeners) source.removeEventListener("abort", listener);
      listeners.clear();
      controller.abort(signal.reason);
    };
    listeners.set(signal, onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

/**
 * Build a signal that aborts after `ms` milliseconds. Falls back to a
 * manual timer when `AbortSignal.timeout` is unavailable; the fallback
 * tags the abort reason with `name = 'TimeoutError'` so `isAbortError`
 * keeps recognising it without `DOMException`.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => {
    const error = new Error("Timed out");
    error.name = "TimeoutError";
    controller.abort(error);
  }, ms);
  return controller.signal;
}

/**
 * `true` when a rejection came from an `AbortController.abort()` —
 * caller cancellation or the per-request timeout. Spec implementations
 * raise `DOMException` here, but Hermes doesn't ship it; duck-type on
 * `.name` instead of using `instanceof`.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * `fetch` with a guaranteed timeout. The combined signal aborts on
 * caller cancellation or `timeoutMs`, whichever fires first.
 */
export function safeFetch(
  url: string,
  controls: RequestControls = {},
  init?: RequestInit,
) {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  const signal = combineSignals(callerSignal, timeoutSignal(timeoutMs));
  const startedAt = Date.now();
  logger.debug("safeFetch.start", {
    ...summarizeUrl(url),
    timeoutMs,
    hasCallerSignal: !!callerSignal,
    method: init?.method ?? "GET",
  });
  return fetch(url, { ...init, signal }).then(
    (response) => {
      logger.debug("safeFetch.response", {
        ...summarizeUrl(url),
        timeoutMs,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
      });
      return response;
    },
    (error) => {
      logger.warn("safeFetch.failed", {
        ...summarizeUrl(url),
        timeoutMs,
        aborted: isAbortError(error),
        durationMs: Date.now() - startedAt,
        error: errField(error),
      });
      throw error;
    },
  );
}

/**
 * Race a promise against a per-call timeout. Used for non-fetch awaits
 * that have no native AbortSignal hook — e.g. nostr-tools `pool.publish`
 * which returns per-relay promises that may never settle if every relay
 * stalls. The caller observes a `TimeoutError`-named Error on expiry.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const startedAt = Date.now();
    logger.debug("safeFetch.withTimeout.start", { label, timeoutMs });
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      logger.warn("safeFetch.withTimeout.timeout", {
        label,
        timeoutMs,
        durationMs: Date.now() - startedAt,
      });
      reject(error);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        logger.debug("safeFetch.withTimeout.done", {
          label,
          timeoutMs,
          durationMs: Date.now() - startedAt,
        });
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        logger.warn("safeFetch.withTimeout.failed", {
          label,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          error: errField(error),
        });
        reject(error);
      },
    );
  });
}
