import { useCallback, useEffect, useRef } from 'react';

interface Options {
  onChangeText: (text: string) => void;
  /** When set, trailing-debounces `onChangeText` by this many ms. */
  debounceMs?: number;
  /** Bumping this cancels any pending debounce (the field was cleared/remounted). */
  clearKey: number;
}

/**
 * Shared text-change handler for the platform GlassSearchBar variants: keeps
 * the latest `onChangeText` in a ref so the handler identity only changes with
 * `debounceMs`, and drops pending debounced emits on clear and unmount.
 */
export function useDebouncedSearchText({ onChangeText, debounceMs, clearKey }: Options) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeTextRef = useRef(onChangeText);
  const latestTextRef = useRef('');

  useEffect(() => {
    onChangeTextRef.current = onChangeText;
  }, [onChangeText]);

  // Cancel pending debounce when clearKey changes (user pressed X)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    latestTextRef.current = '';
  }, [clearKey]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return useCallback(
    (text: string) => {
      if (!debounceMs) {
        onChangeTextRef.current(text);
        return;
      }
      latestTextRef.current = text;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChangeTextRef.current(latestTextRef.current);
      }, debounceMs);
    },
    [debounceMs]
  );
}
