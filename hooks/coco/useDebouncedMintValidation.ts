import { useState, useEffect, useCallback, useRef } from 'react';
import { looksLikeMintUrl } from 'helper/fuzzySearch';
import { fetchMintInfo } from '@/helper/apiClient';

interface ValidationState {
  isValid: boolean | null; // null = not checked, true = valid, false = invalid
  isLoading: boolean;
  error: string | null;
}

/**
 * Custom hook for debounced mint URL validation
 * Validates mint URLs with a debounce delay to avoid excessive API calls
 */
export function useDebouncedMintValidation(debounceMs: number = 800) {
  const [validationState, setValidationState] = useState<ValidationState>({
    isValid: null,
    isLoading: false,
    error: null,
  });
  const [url, setUrl] = useState('');
  const [mintInfo, setMintInfo] = useState<any>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Normalize URL for API calls by ensuring https:// prefix
  const normalizeUrlForApi = useCallback((rawUrl: string): string => {
    let normalized = rawUrl.trim().toLowerCase();
    // Remove www. prefix if present (after removing protocol)
    const withoutProtocol = normalized.replace(/^https?:\/\//, '');
    const withoutWww = withoutProtocol.replace(/^www\./, '');
    // Add https:// back for API call
    return `https://${withoutWww}`;
  }, []);

  const validateUrl = useCallback(async (mintUrl: string) => {
    if (!mintUrl.trim()) {
      setValidationState({
        isValid: null,
        isLoading: false,
        error: null,
      });
      setMintInfo(null);
      return;
    }

    // Normalize URL for API call (ensures https:// prefix)
    const normalizedUrl = normalizeUrlForApi(mintUrl);

    // Basic URL validation
    try {
      new URL(normalizedUrl);
    } catch {
      setValidationState({
        isValid: false,
        isLoading: false,
        error: 'Invalid URL format',
      });
      setMintInfo(null);
      return;
    }

    setValidationState((prev) => ({ ...prev, isLoading: true, error: null }));

    // For validation, we need to successfully fetch mint info
    // Only mark as valid if we actually get valid mint info back
    const mintInfoResult = await fetchMintInfo(normalizedUrl);

    if (mintInfoResult.isErr()) {
      // If we can't get mint info, it's invalid
      setValidationState({
        isValid: false,
        isLoading: false,
        error: 'Mint not accessible or invalid',
      });
      setMintInfo(null);
    } else {
      // Only valid if we got actual mint info back
      const hasValidInfo = mintInfoResult.value !== null;
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

      // Clear existing timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Reset state if URL is empty
      if (!mintUrl.trim()) {
        setValidationState({
          isValid: null,
          isLoading: false,
          error: null,
        });
        setMintInfo(null);
        return;
      }

      // Set loading state immediately for better UX
      setValidationState((prev) => ({ ...prev, isLoading: true, error: null }));

      // Debounce the validation
      debounceTimeoutRef.current = setTimeout(() => {
        validateUrl(mintUrl);
      }, debounceMs);
    },
    [validateUrl, debounceMs]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const reset = useCallback(() => {
    setUrl('');
    setValidationState({
      isValid: null,
      isLoading: false,
      error: null,
    });
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
