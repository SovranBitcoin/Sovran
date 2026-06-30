import { useInsertionEffect, useRef, type MutableRefObject } from 'react';

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
