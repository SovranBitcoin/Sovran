import { useState, useEffect, useCallback, useRef } from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';

import { fetchMintInfo } from '@/shared/lib/apiClient';
import { normalizeUrlForApi } from '@/shared/lib/url';
import { log } from '@/shared/lib/logger';

interface ValidationState {
  isValid: boolean | null;
  isLoading: boolean;
  error: string | null;
}

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

/**
 * Debounced mint URL validation via fetchMintInfo.
 * Marks a mint as valid only when its /v1/info endpoint responds successfully.
 */
export function useDebouncedMintValidation(debounceMs: number = 800) {
  const [validationState, setValidationState] = useState<ValidationState>({
    isValid: null,
    isLoading: false,
    error: null,
  });
  const [url, setUrl] = useState('');
  const [mintInfo, setMintInfo] = useState<GetInfoResponse | null>(null);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the in-flight validation. Each new keystroke aborts the previous
  // request so a slow mint that responds after the user has typed past it
  // can't overwrite the result for the current URL.
  const inFlightRef = useRef<AbortController | null>(null);

  const validateUrl = useCallback(async (mintUrl: string) => {
    if (!mintUrl.trim()) {
      setValidationState({ isValid: null, isLoading: false, error: null });
      setMintInfo(null);
      return;
    }

    const normalizedUrl = normalizeUrlForApi(mintUrl);

    try {
      new URL(normalizedUrl);
    } catch {
      log.debug('mint.validate.invalid_url', { mintUrlLength: mintUrl.length });
      setValidationState({ isValid: false, isLoading: false, error: 'Invalid URL format' });
      setMintInfo(null);
      return;
    }

    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    log.debug('mint.validate.start', { ...mintUrlLogFields(normalizedUrl) });
    setValidationState((prev) => ({ ...prev, isLoading: true, error: null }));

    const mintInfoResult = await fetchMintInfo(normalizedUrl, { signal: controller.signal });
    if (controller.signal.aborted) return;

    if (mintInfoResult.isErr()) {
      log.warn('mint.validate.unreachable', { ...mintUrlLogFields(normalizedUrl) });
      setValidationState({
        isValid: false,
        isLoading: false,
        error: 'Mint not accessible or invalid',
      });
      setMintInfo(null);
    } else {
      const hasValidInfo = mintInfoResult.value !== null;
      log.info('mint.validate.result', {
        ...mintUrlLogFields(normalizedUrl),
        isValid: hasValidInfo,
      });
      setValidationState({
        isValid: hasValidInfo,
        isLoading: false,
        error: hasValidInfo ? null : 'Mint not accessible or invalid',
      });
      setMintInfo(mintInfoResult.value);
    }
  }, []);

  const debouncedValidate = useCallback(
    (mintUrl: string) => {
      setUrl(mintUrl);

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      if (!mintUrl.trim()) {
        inFlightRef.current?.abort();
        inFlightRef.current = null;
        setValidationState({ isValid: null, isLoading: false, error: null });
        setMintInfo(null);
        return;
      }

      setValidationState((prev) => ({ ...prev, isLoading: true, error: null }));

      debounceTimeoutRef.current = setTimeout(() => {
        void validateUrl(mintUrl);
      }, debounceMs);
    },
    [validateUrl, debounceMs]
  );

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      inFlightRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    setUrl('');
    setValidationState({ isValid: null, isLoading: false, error: null });
    setMintInfo(null);
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    inFlightRef.current?.abort();
    inFlightRef.current = null;
  }, []);

  return {
    url,
    setUrl: debouncedValidate,
    validationState,
    mintInfo,
    reset,
  };
}
