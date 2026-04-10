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
      log.debug('mint.validate.invalid_url', { mintUrl });
      setValidationState({ isValid: false, isLoading: false, error: 'Invalid URL format' });
      setMintInfo(null);
      return;
    }

    log.debug('mint.validate.start', { mintUrl: normalizedUrl });
    setValidationState((prev) => ({ ...prev, isLoading: true, error: null }));

    const mintInfoResult = await fetchMintInfo(normalizedUrl);

    if (mintInfoResult.isErr()) {
      log.warn('mint.validate.unreachable', { mintUrl: normalizedUrl });
      setValidationState({
        isValid: false,
        isLoading: false,
        error: 'Mint not accessible or invalid',
      });
      setMintInfo(null);
    } else {
      const hasValidInfo = mintInfoResult.value !== null;
      log.info('mint.validate.result', { mintUrl: normalizedUrl, isValid: hasValidInfo });
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
        setValidationState({ isValid: null, isLoading: false, error: null });
        setMintInfo(null);
        return;
      }

      setValidationState((prev) => ({ ...prev, isLoading: true, error: null }));

      debounceTimeoutRef.current = setTimeout(() => {
        validateUrl(mintUrl);
      }, debounceMs);
    },
    [validateUrl, debounceMs]
  );

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const reset = useCallback(() => {
    setUrl('');
    setValidationState({ isValid: null, isLoading: false, error: null });
    setMintInfo(null);
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
  }, []);

  return {
    url,
    setUrl: debouncedValidate,
    validationState,
    mintInfo,
    reset,
  };
}
