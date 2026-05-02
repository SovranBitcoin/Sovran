import { useCallback, useRef } from 'react';

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

  return useCallback(
    async (...args: TArgs) => {
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
    },
    [fn]
  );
}
