import { useCallback, useEffect, useRef } from 'react';

import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

import { nextKeypadValue, type KeyboardValue } from './keypadInput';

/**
 * The press handler every amount keypad shares, whatever its keys look like.
 *
 * The value lives in a ref, not state: no keypad renders it — the parent owns
 * the display and hears every change through `onKeyPress`. That keeps the
 * handler stable (so keys never re-render), and updating it synchronously at
 * tap time means two presses in one React batch still compose, which reading
 * it from state would not guarantee.
 */
export function useKeypadPress(
  value: string | undefined,
  unit: string,
  onKeyPress: (value: string) => void
): (key: KeyboardValue) => void {
  const inputRef = useRef(value ?? '');

  useEffect(() => {
    if (value !== undefined) {
      inputRef.current = value;
    }
  }, [value]);

  return useCallback(
    (key: KeyboardValue) => {
      void (String(key) === '<' ? EnhancedHaptics.actionHaptic() : EnhancedHaptics.buttonHaptic());
      const next = nextKeypadValue(inputRef.current, key, unit);
      if (next === null) return;
      inputRef.current = next;
      onKeyPress(next);
    },
    [onKeyPress, unit]
  );
}
