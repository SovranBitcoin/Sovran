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

    // Basic URL validation
    try {
      new URL(mintUrl);
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

    // For validation, we just need to check if we can get mint info
    // We don't need to check if it's already known since we want to add new mints
    const mintInfoResult = await fetchMintInfo(mintUrl);

    if (mintInfoResult.isErr()) {
      // If we can't get mint info, it might still be a valid URL
      // Let's check if it looks like a valid mint URL
      const looksValid = looksLikeMintUrl(mintUrl);

      setValidationState({
        isValid: looksValid,
        isLoading: false,
        error: looksValid ? null : 'Invalid mint URL format',
      });
      setMintInfo(null);
    } else {
      setValidationState({
        isValid: mintInfoResult.value !== null,
        isLoading: false,
        error: mintInfoResult.value ? null : 'Mint not accessible or invalid',
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
