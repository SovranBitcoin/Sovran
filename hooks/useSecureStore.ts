import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import * as nip06 from 'nostr-tools/nip06';
import { nip19 } from 'nostr-tools';

// Keys for secure storage
const STORAGE_KEYS = {
  USER_MNEMONIC: 'user_mnemonic',
  USER_PROFILE_DATA: 'user_profile_data',
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
export const useSecureStore = (key: StorageKey, autoLoad: boolean = true): UseSecureStoreReturn => {
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
 * Convenience hook specifically for profile data access
 * @param autoLoad Whether to automatically load the profile data on mount (default: true)
 * @returns Object containing profile data value, loading state, error, and methods to manage the profile data
 */
export const useProfileData = (autoLoad: boolean = true) => {
  return useSecureStore('USER_PROFILE_DATA', autoLoad);
};

/**
 * Hook for deriving cashu mnemonic from the main mnemonic
 * @param accountIndex The account index to derive the cashu mnemonic for (default: 0)
 * @param autoLoad Whether to automatically derive the cashu mnemonic on mount (default: true)
 * @returns Object containing derived cashu mnemonic, loading state, error, and refresh method
 */
export const useCashuMnemonic = (accountIndex: number = 0, autoLoad: boolean = true) => {
  const { value: mnemonic, loading: mnemonicLoading, error: mnemonicError } = useMnemonic(autoLoad);
  const [cashuMnemonic, setCashuMnemonic] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const deriveCashuMnemonic = useCallback(async () => {
    if (!mnemonic) {
      setCashuMnemonic(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Generate HD root key from mnemonic
      const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));

      // Derive the specific path for this account index
      const DERIVATION_PATH = `m/44'/129372'`;
      const path = `${DERIVATION_PATH}/0'/${accountIndex}'/0/0`;
      const seed = root.derive(path);

      // Generate the cashu mnemonic from the derived private key
      const derivedCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey as Buffer, wordlist);

      setCashuMnemonic(derivedCashuMnemonic);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to derive cashu mnemonic';
      setError(errorMessage);
      console.error('Failed to derive cashu mnemonic:', err);
      setCashuMnemonic(null);
    } finally {
      setLoading(false);
    }
  }, [mnemonic, accountIndex]);

  // Auto-derive when mnemonic changes or on mount
  useEffect(() => {
    if (autoLoad && mnemonic) {
      deriveCashuMnemonic();
    }
  }, [autoLoad, mnemonic, deriveCashuMnemonic]);

  // Update loading state based on mnemonic loading
  useEffect(() => {
    if (mnemonicLoading) {
      setLoading(true);
    }
  }, [mnemonicLoading]);

  // Update error state based on mnemonic error
  useEffect(() => {
    if (mnemonicError) {
      setError(mnemonicError);
    }
  }, [mnemonicError]);

  const refresh = useCallback(async () => {
    await deriveCashuMnemonic();
  }, [deriveCashuMnemonic]);

  return {
    value: cashuMnemonic,
    loading: loading || mnemonicLoading,
    error: error || mnemonicError,
    refresh,
    accountIndex,
  };
};

/**
 * Hook for deriving Nostr keys (npub/nsec) from the main mnemonic
 * @param accountIndex The account index to derive the Nostr keys for (default: 0)
 * @param autoLoad Whether to automatically derive the keys on mount (default: true)
 * @returns Object containing derived npub/nsec keys, loading state, error, and refresh method
 */
export const useNostrKeys = (accountIndex: number = 0, autoLoad: boolean = true) => {
  const { value: mnemonic, loading: mnemonicLoading, error: mnemonicError } = useMnemonic(autoLoad);
  const [nostrKeys, setNostrKeys] = useState<{
    npub: string;
    nsec: string;
    pubkey: string;
    privateKey: Uint8Array;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const deriveNostrKeys = useCallback(async () => {
    if (!mnemonic) {
      setNostrKeys(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Generate keys from mnemonic using NIP-06
      const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
        mnemonic,
        undefined,
        accountIndex
      );

      // Encode the keys
      const nsec = nip19.nsecEncode(sk);
      const npub = nip19.npubEncode(pk);

      setNostrKeys({
        npub,
        nsec,
        pubkey: pk,
        privateKey: sk,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to derive Nostr keys';
      setError(errorMessage);
      console.error('Failed to derive Nostr keys:', err);
      setNostrKeys(null);
    } finally {
      setLoading(false);
    }
  }, [mnemonic, accountIndex]);

  // Auto-derive when mnemonic changes or on mount
  useEffect(() => {
    if (autoLoad && mnemonic) {
      deriveNostrKeys();
    }
  }, [autoLoad, mnemonic, deriveNostrKeys]);

  // Update loading state based on mnemonic loading
  useEffect(() => {
    if (mnemonicLoading) {
      setLoading(true);
    }
  }, [mnemonicLoading]);

  // Update error state based on mnemonic error
  useEffect(() => {
    if (mnemonicError) {
      setError(mnemonicError);
    }
  }, [mnemonicError]);

  const refresh = useCallback(async () => {
    await deriveNostrKeys();
  }, [deriveNostrKeys]);

  return {
    value: nostrKeys,
    loading: loading || mnemonicLoading,
    error: error || mnemonicError,
    refresh,
    accountIndex,
  };
};
