import { useRef } from 'react';

/**
 * Returns a referentially stable version of `value` that only changes
 * when one of its own enumerable values changes (shallow compare).
 *
 * Use this to stabilise values from upstream hooks (e.g. coco-react) or from
 * `.map()`-style derivations that return a new reference on every render even
 * when the data is the same. Works for plain objects and for arrays.
 *
 * Keeping the ref read/write in here — rather than inline in a component —
 * is deliberate: React Compiler skips any component that touches a ref during
 * render, so an inline copy of this idiom costs that component its
 * auto-memoization. This hook is the one place that pays that price.
 */
export function useShallowMemo<T extends object>(value: T): T {
  const ref = useRef(value);
  if (!shallowEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}

function shallowEqual(a: object, b: object): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}
