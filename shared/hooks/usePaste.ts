import { useCallback, useState } from 'react';

import * as Clipboard from 'expo-clipboard';

import { debugLog } from '@/shared/lib/debugLog';

interface UsePasteConfig<TValue = string> {
  normalize?: (text: string) => TValue | Promise<TValue>;
  isEmpty?: (value: TValue) => boolean;
  onEmpty?: () => void;
  onPaste: (value: TValue, rawText: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * Shared clipboard paste handler for flows that accept pasted payment input.
 * Owns clipboard read + empty checks so screens only implement domain logic.
 */
export function usePaste<TValue = string>({
  normalize,
  isEmpty,
  onEmpty,
  onPaste,
  onError,
}: UsePasteConfig<TValue>) {
  const [isPasting, setIsPasting] = useState(false);

  const handlePaste = useCallback(async (): Promise<void> => {
    // #region agent log
    debugLog({
      location: 'usePaste.ts:handlePaste',
      message: 'usePaste handlePaste before',
      phase: 'before',
    });
    // #endregion
    setIsPasting(true);

    try {
      const rawText = (await Clipboard.getStringAsync()).trim();
      const normalized = normalize ? await normalize(rawText) : (rawText as TValue);
      const isValueEmpty = isEmpty ? isEmpty(normalized) : !normalized;

      if (isValueEmpty) {
        onEmpty?.();
        return;
      }

      await onPaste(normalized, rawText);
      // #region agent log
      debugLog({
        location: 'usePaste.ts:handlePaste',
        message: 'usePaste handlePaste after',
        phase: 'after',
      });
      // #endregion
    } catch (error) {
      onError?.(error);
    } finally {
      setIsPasting(false);
    }
  }, [isEmpty, normalize, onEmpty, onError, onPaste]);

  return { handlePaste, isPasting };
}
