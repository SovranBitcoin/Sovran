import { useRef } from 'react';

/**
 * Returns a referentially stable version of `value` that only changes
 * when one of its own enumerable values changes (shallow compare).
 *
 * Use this to stabilise objects from upstream hooks (e.g. coco-react)
 * that return a new reference on every render even when the data is the same.
 */
export function useShallowMemo<T extends Record<string, unknown>>(value: T): T {
  const ref = useRef(value);
  if (!shallowEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
