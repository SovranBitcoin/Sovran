import { useEffect, useState } from 'react';

/**
 * Trailing-debounced mirror of `value`. The returned value follows `value`
 * only after it has held still for `delayMs`; with `immediate` it follows on
 * the same effect tick (used for inputs below a minimum length so clearing a
 * query does not wait out the debounce).
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
  options?: { immediate?: boolean }
): T {
  const [debounced, setDebounced] = useState(value);
  const immediate = options?.immediate ?? false;
  useEffect(() => {
    if (immediate || delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, immediate]);
  return debounced;
}
