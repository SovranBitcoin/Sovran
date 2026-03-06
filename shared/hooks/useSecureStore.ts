import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Keys for secure storage
const STORAGE_KEYS = {
  USER_MNEMONIC: 'user_mnemonic',
} as const;

// iOS-specific options for enhanced security
const IOS_SECURE_OPTIONS = {
  requireAuthentication: false, // Set to false to avoid biometric requirement in development
  authenticatePrompt: 'Authenticate to access your Sovran wallet',
  // For production, you might want to set requireAuthentication: true
} as const;

type StorageKey = keyof typeof STORAGE_KEYS;

interface UseSecureStoreReturn {
  value: string | null;
  loading: boolean;
  error: string | null;
  setValue: (value: string) => Promise<boolean>;
  removeValue: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Custom hook for accessing secure storage
 * @param key The storage key to access
 * @param autoLoad Whether to automatically load the value on mount (default: true)
 * @returns Object containing value, loading state, error, and methods to manage the value
 */
const useSecureStore = (key: StorageKey, autoLoad: boolean = true): UseSecureStoreReturn => {
  const [value, setValueState] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const getSecureOptions = useCallback(() => {
    return Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
  }, []);

  const loadValue = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const options = getSecureOptions();
      const storedValue = await SecureStore.getItemAsync(STORAGE_KEYS[key], options);

      setValueState(storedValue);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load from secure storage';
      setError(errorMessage);
      console.error(`Failed to retrieve ${key}:`, err);
    } finally {
      setLoading(false);
    }
  }, [key, getSecureOptions]);

  const setValue = useCallback(
    async (newValue: string): Promise<boolean> => {
      try {
        setError(null);

        if (!newValue || typeof newValue !== 'string') {
          throw new Error('Invalid value provided');
        }

        const options = getSecureOptions();
        await SecureStore.setItemAsync(STORAGE_KEYS[key], newValue, options);

        setValueState(newValue);
        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to store value';
        setError(errorMessage);
        console.error(`Failed to store ${key}:`, err);
        return false;
      }
    },
    [key, getSecureOptions]
  );

  const removeValue = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);

      const options = getSecureOptions();
      await SecureStore.deleteItemAsync(STORAGE_KEYS[key], options);

      setValueState(null);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove value';
      setError(errorMessage);
      console.error(`Failed to remove ${key}:`, err);
      return false;
    }
  }, [key, getSecureOptions]);

  const refresh = useCallback(async () => {
    await loadValue();
  }, [loadValue]);

  // Auto-load on mount if enabled
  useEffect(() => {
    if (autoLoad) {
      loadValue();
    }
  }, [autoLoad, loadValue]);

  return {
    value,
    loading,
    error,
    setValue,
    removeValue,
    refresh,
  };
};

/**
 * Convenience hook specifically for mnemonic access
 * @param autoLoad Whether to automatically load the mnemonic on mount (default: true)
 * @returns Object containing mnemonic value, loading state, error, and methods to manage the mnemonic
 */
export const useMnemonic = (autoLoad: boolean = true) => {
  return useSecureStore('USER_MNEMONIC', autoLoad);
};

/**
 * Hook for deriving cashu mnemonic from the main mnemonic
 * @param accountIndex The account index to derive the cashu mnemonic for (default: 0)
 * @param autoLoad Whether to automatically derive the cashu mnemonic on mount (default: true)
 * @returns Object containing derived cashu mnemonic, loading state, error, and refresh method
 */
export const useCashuMnemonic = (accountIndex: number = 0, autoLoad: boolean = true) => {
  // Import the context hook dynamically to avoid circular dependencies
  const { useNostrKeysContext } = require('../providers/NostrKeysProvider');
  const {
    cashuMnemonic,
    isReady,
    isLoading,
    error: providerError,
    refresh: refreshProvider,
    getCashuMnemonicForAccount,
  } = useNostrKeysContext();
  const [localCashuMnemonic, setLocalCashuMnemonic] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const loadCashuMnemonicForAccount = useCallback(async () => {
    if (!isReady) {
      setLoading(true);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // If requesting default account (0), use cached mnemonic from provider
      if (accountIndex === 0) {
        setLocalCashuMnemonic(cashuMnemonic);
      } else {
        // For other accounts, get mnemonic from provider
        const accountMnemonic = await getCashuMnemonicForAccount(accountIndex);
        setLocalCashuMnemonic(accountMnemonic);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load cashu mnemonic';
      setError(errorMessage);
      console.error('Failed to load cashu mnemonic:', err);
      setLocalCashuMnemonic(null);
    } finally {
      setLoading(false);
    }
  }, [isReady, accountIndex, cashuMnemonic, getCashuMnemonicForAccount]);

  // Auto-load when provider is ready or account index changes
  useEffect(() => {
    if (autoLoad && isReady) {
      loadCashuMnemonicForAccount();
    }
  }, [autoLoad, isReady, loadCashuMnemonicForAccount]);

  // Update loading state based on provider loading
  useEffect(() => {
    if (isLoading) {
      setLoading(true);
    }
  }, [isLoading]);

  // Update error state based on provider error
  useEffect(() => {
    if (providerError) {
      setError(providerError);
    }
  }, [providerError]);

  const refresh = useCallback(async () => {
    if (accountIndex === 0) {
      // Refresh the provider for default account
      await refreshProvider();
    } else {
      // Load mnemonic for specific account
      await loadCashuMnemonicForAccount();
    }
  }, [accountIndex, refreshProvider, loadCashuMnemonicForAccount]);

  return {
    value: localCashuMnemonic,
    loading: loading || isLoading,
    error: error,
    refresh,
    accountIndex,
  };
};
