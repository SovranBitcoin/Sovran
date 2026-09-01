import { useCallback, useInsertionEffect, useRef, type MutableRefObject } from 'react';

/**
 * Mirror the latest value of a prop, store slice, or callback into a ref so
 * stable handlers and subscriptions can read it without remounting.
 *
 * Writes happen in `useInsertionEffect`, which runs synchronously after
 * commit and before any `useLayoutEffect` / `useEffect` body — so reads
 * inside subsequent effects see the freshly-mirrored value while staying
 * out of the render path. Mutating a ref during render would violate the
 * Rules of React and confuse React Compiler's auto-memoization.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * A stable getter for the latest `value`.
 *
 * The ref lives in here so a caller can hand the getter to a factory it builds
 * during render — an adapter, a bridge, a gesture — without React Compiler
 * reading that as a render-time ref access and skipping the whole component.
 */
export function useLatestGetter<T>(value: T): () => T {
  const ref = useLatestRef(value);
  return useCallback(() => ref.current, [ref]);
}
