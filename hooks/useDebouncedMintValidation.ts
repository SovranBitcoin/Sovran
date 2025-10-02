import { useState, useEffect, useCallback, useRef } from 'react';
import { useMintManagement } from './coco/useMintManagement';
import { looksLikeMintUrl } from 'helper/fuzzySearch';

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
  const { isKnownMint, getMintInfo } = useMintManagement();
  const [validationState, setValidationState] = useState<ValidationState>({
    isValid: null,
    isLoading: false,
    error: null,
  });
  const [url, setUrl] = useState('');
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const validateUrl = useCallback(async (mintUrl: string) => {
    if (!mintUrl.trim()) {
      setValidationState({
        isValid: null,
        isLoading: false,
        error: null,
      });
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
      return;
    }

    setValidationState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // For validation, we just need to check if we can get mint info
      // We don't need to check if it's already known since we want to add new mints
      const mintInfo = await getMintInfo(mintUrl);

      setValidationState({
        isValid: mintInfo !== null,
        isLoading: false,
        error: mintInfo ? null : 'Mint not accessible or invalid',
      });
    } catch (error) {
      // If we can't get mint info, it might still be a valid URL
      // Let's check if it looks like a valid mint URL
      const looksValid = looksLikeMintUrl(mintUrl);

      setValidationState({
        isValid: looksValid,
        isLoading: false,
        error: looksValid ? null : 'Invalid mint URL format',
      });
    }
  }, [getMintInfo]);

  const debouncedValidate = useCallback((mintUrl: string) => {
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
      return;
    }

    // Set loading state immediately for better UX
    setValidationState(prev => ({ ...prev, isLoading: true, error: null }));

    // Debounce the validation
    debounceTimeoutRef.current = setTimeout(() => {
      validateUrl(mintUrl);
    }, debounceMs);
  }, [validateUrl, debounceMs]);

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
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
  }, []);

  return {
    url,
    setUrl: debouncedValidate,
    validationState,
    reset,
  };
}
