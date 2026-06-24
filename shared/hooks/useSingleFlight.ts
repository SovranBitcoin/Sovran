import { useRef } from 'react';

/**
 * Wraps an async callback so that calls made while a previous call is still
 * in flight are dropped synchronously. The guard sits on a `useRef` so it
 * fires before React has a chance to flip a `setState`-backed disabled flag,
 * which is the gap that lets a rapid double-tap deliver two payments,
 * burn two AI billing rounds, or invite-and-create-group twice.
 *
 * The returned callback resolves with the original function's value on the
 * winning call and `undefined` for dropped calls. Callers that need to know
 * which call won should compare the resolved value against `undefined`.
 *
 * The guard is per-mount: state lives on a ref scoped to the component, so
 * two instances of the same screen each get their own single-flight slot.
 *
 * Synchronous callbacks pass through untouched — the guard only locks while
 * the returned promise is pending.
 */
export function useSingleFlight<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult | undefined> {
  const inFlightRef = useRef<Promise<TResult> | null>(null);

  return async (...args: TArgs) => {
    if (inFlightRef.current) return undefined;
    const promise = fn(...args);
    inFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      if (inFlightRef.current === promise) {
        inFlightRef.current = null;
      }
    }
  };
}

/**
 * Per-key variant of `useSingleFlight`. Concurrent calls with the same key
 * are dropped; concurrent calls with different keys run in parallel. Use for
 * domain operations where the work is per-target — e.g. liking post A while
 * post B is still publishing should not block, but tapping like on post A
 * twice should drop the duplicate.
 *
 * The key extractor reads from the first call argument by convention; pass
 * a custom one for handlers whose target lives elsewhere in the args.
 */
export function useKeyedSingleFlight<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  keyOf: (...args: TArgs) => string
): (...args: TArgs) => Promise<TResult | undefined> {
  const inFlightRef = useRef<Map<string, Promise<TResult>>>(new Map());

  return async (...args: TArgs) => {
    const key = keyOf(...args);
    if (inFlightRef.current.has(key)) return undefined;
    const promise = fn(...args);
    inFlightRef.current.set(key, promise);
    try {
      return await promise;
    } finally {
      if (inFlightRef.current.get(key) === promise) {
        inFlightRef.current.delete(key);
      }
    }
  };
}
