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

/**
 * Combine an arbitrary number of signals into one. The result aborts when
 * any input aborts. Hand-rolled because `AbortSignal.any` is not yet on
 * every Hermes build the wallet ships against; the listener pattern works
 * everywhere `AbortController` does.
 */
export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
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
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => {
    const error = new Error('Timed out');
    error.name = 'TimeoutError';
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
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * `fetch` with a guaranteed timeout. The combined signal aborts on
 * caller cancellation or `timeoutMs`, whichever fires first.
 */
export function safeFetch(url: string, controls: RequestControls = {}, init?: RequestInit) {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  const signal = combineSignals(callerSignal, timeoutSignal(timeoutMs));
  return fetch(url, { ...init, signal });
}

/**
 * Race a promise against a per-call timeout. Used for non-fetch awaits
 * that have no native AbortSignal hook — e.g. nostr-tools `pool.publish`
 * which returns per-relay promises that may never settle if every relay
 * stalls. The caller observes a `TimeoutError`-named Error on expiry.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
