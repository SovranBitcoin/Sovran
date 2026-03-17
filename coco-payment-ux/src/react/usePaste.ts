// ---------------------------------------------------------------------------
// usePaste — generic clipboard paste handler
//
// Owns clipboard read + empty checks so screens only implement domain logic.
// The platform-specific clipboard reader is injected via `readClipboard`.
// ---------------------------------------------------------------------------

import { useCallback, useState } from 'react';

export interface UsePasteConfig<TValue = string> {
  /**
   * Platform-specific clipboard reader.
   * E.g. `() => Clipboard.getStringAsync()` for Expo.
   */
  readClipboard: () => Promise<string>;
  /** Transform raw text before passing to onPaste. */
  normalize?: (text: string) => TValue | Promise<TValue>;
  /** Custom emptiness check. Defaults to `!value`. */
  isEmpty?: (value: TValue) => boolean;
  /** Called when clipboard is empty (after normalize + isEmpty). */
  onEmpty?: () => void;
  /** Called with the (optionally normalized) value and raw text. */
  onPaste: (value: TValue, rawText: string) => void | Promise<void>;
  /** Called on any error during read/normalize/paste. */
  onError?: (error: unknown) => void;
}

/**
 * Shared clipboard paste handler for flows that accept pasted payment input.
 */
export function usePaste<TValue = string>({
  readClipboard,
  normalize,
  isEmpty,
  onEmpty,
  onPaste,
  onError,
}: UsePasteConfig<TValue>) {
  const [isPasting, setIsPasting] = useState(false);

  const handlePaste = useCallback(async (): Promise<void> => {
    setIsPasting(true);

    try {
      const rawText = (await readClipboard()).trim();
      const normalized = normalize ? await normalize(rawText) : (rawText as TValue);
      const isValueEmpty = isEmpty ? isEmpty(normalized) : !normalized;

      if (isValueEmpty) {
        onEmpty?.();
        return;
      }

      await onPaste(normalized, rawText);
    } catch (error) {
      onError?.(error);
    } finally {
      setIsPasting(false);
    }
  }, [readClipboard, isEmpty, normalize, onEmpty, onError, onPaste]);

  return { handlePaste, isPasting };
}
