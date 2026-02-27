import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useRef,
} from 'react';
import { useMnemonic } from 'hooks/useSecureStore';
import {
  ensureMnemonicExists,
  retrieveDerivedKeys,
  storeDerivedKeys,
  retrieveCashuMnemonic,
  storeCashuMnemonic,
  hashMnemonic,
  type CachedDerivedKeys,
} from 'helper/secureStorage';
import * as nip06 from 'nostr-tools/nip06';
import { nip19 } from 'nostr-tools';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { CocoManager } from 'helper/coco/manager';
import { useInitializationStage } from './InitializationProvider';
import { useProfileStore } from '@/stores/profileStore';
import { initLog } from '@/helper/initTiming';

/**
 * Check if mnemonic exists in Redux store (profile 0) as fallback
 */
function getMnemonicFromRedux(): string | null {
  try {
    // Import store dynamically to avoid circular dependencies
    // eslint-disable-next-line
    const { store } = require('../redux/store');
    const state = store.getState();
    const nostrState = state.nostr;

    // Check if profile 0 exists and has a mnemonic
    if (nostrState.profiles && nostrState.profiles.length > 0) {
      const profile0 = nostrState.profiles[0];
      if (profile0 && profile0.mnemonic) {
        console.log('Found main mnemonic in Redux store (profile 0):', profile0.mnemonic);

        // Validate the mnemonic format
        const words = profile0.mnemonic.split(' ');
        if (words.length === 12 || words.length === 24) {
          console.log('Redux mnemonic appears valid, using it');
          return profile0.mnemonic;
        } else {
          console.warn('Redux mnemonic has invalid format:', words.length, 'words');
        }
      } else {
        console.log('Profile 0 exists but no mnemonic found:', profile0);
      }
    } else {
      console.log('No profiles found in Redux store');
    }

    console.log('No mnemonic found in Redux store (profile 0)');
    return null;
  } catch (error) {
    console.error('Failed to get mnemonic from Redux store:', error);
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface NostrKeys {
  npub: string;
  nsec: string;
  pubkey: string;
  privateKey: Uint8Array;
}

interface NostrKeysContextValue {
  keys: NostrKeys | null;
  cashuMnemonic: string | null;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getKeysForAccount: (accountIndex: number) => Promise<NostrKeys | null>;
  getCashuMnemonicForAccount: (accountIndex: number) => Promise<string | null>;
}

const NostrKeysContext = createContext<NostrKeysContextValue>({
  keys: null,
  cashuMnemonic: null,
  isReady: false,
  isLoading: false,
  error: null,
  refresh: async () => {},
  getKeysForAccount: async () => null,
  getCashuMnemonicForAccount: async () => null,
});

export const useNostrKeysContext = () => {
  const context = useContext(NostrKeysContext);
  if (!context) {
    throw new Error('useNostrKeysContext must be used within a NostrKeysProvider');
  }
  return context;
};

interface NostrKeysProviderProps {
  children: ReactNode;
  defaultAccountIndex?: number;
}

/**
 * NostrKeysProvider handles the computation and caching of Nostr keys
 * This prevents expensive key derivation from happening multiple times
 */
export function NostrKeysProvider({ children, defaultAccountIndex = 0 }: NostrKeysProviderProps) {
  const stage = useInitializationStage('nostr', {
    message: 'Initializing keys...',
    dependsOn: ['migrations'],
  });
  const { value: mnemonic, loading: mnemonicLoading, error: mnemonicError } = useMnemonic();
  const [keys, setKeys] = useState<NostrKeys | null>(null);
  const [cashuMnemonic, setCashuMnemonic] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedKeys, setCachedKeys] = useState<Map<number, NostrKeys>>(new Map());
  const [cachedCashuMnemonics, setCachedCashuMnemonics] = useState<Map<number, string>>(new Map());
  const hasStarted = useRef(false);

  const deriveKeys = useCallback(
    async (accountIndex: number): Promise<NostrKeys | null> => {
      if (!mnemonic) {
        return null;
      }

      try {
        // Check cache first
        if (cachedKeys.has(accountIndex)) {
          return cachedKeys.get(accountIndex)!;
        }

        // Generate keys from mnemonic using NIP-06
        console.log('Deriving keys from mnemonic for account index:', accountIndex);
        console.log('Mnemonic length:', mnemonic.split(' ').length, 'words');

        const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
          mnemonic,
          undefined,
          accountIndex
        );

        console.log('Derived keys - pubkey length:', pk.length, 'privateKey length:', sk.length);

        // Encode the keys
        console.log('Encoding keys...');
        const nsec = nip19.nsecEncode(sk);
        const npub = nip19.npubEncode(pk);
        console.log('Encoded nsec:', nsec, 'npub:', npub);

        const derivedKeys: NostrKeys = {
          npub,
          nsec,
          pubkey: pk,
          privateKey: sk,
        };

        // Cache the keys
        setCachedKeys((prev) => new Map(prev).set(accountIndex, derivedKeys));

        return derivedKeys;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to derive Nostr keys';
        console.error('Failed to derive Nostr keys:', err);
        throw new Error(errorMessage);
      }
    },
    [mnemonic, cachedKeys]
  );

  const deriveCashuMnemonic = useCallback(
    async (accountIndex: number): Promise<string | null> => {
      if (!mnemonic) {
        return null;
      }

      try {
        // Check cache first
        if (cachedCashuMnemonics.has(accountIndex)) {
          return cachedCashuMnemonics.get(accountIndex)!;
        }

        // Generate HD root key from mnemonic
        const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));

        // Derive the specific path for this account index
        const DERIVATION_PATH = `m/44'/129372'`;
        const path = `${DERIVATION_PATH}/0'/${accountIndex}'/0/0`;
        const seed = root.derive(path);

        // Generate the cashu mnemonic from the derived private key
        const derivedCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey as Buffer, wordlist);

        // Cache the mnemonic
        setCachedCashuMnemonics((prev) => new Map(prev).set(accountIndex, derivedCashuMnemonic));

        return derivedCashuMnemonic;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to derive cashu mnemonic';
        console.error('Failed to derive cashu mnemonic:', err);
        throw new Error(errorMessage);
      }
    },
    [mnemonic, cachedCashuMnemonics]
  );

  const getKeysForAccount = useCallback(
    async (accountIndex: number): Promise<NostrKeys | null> => {
      try {
        return await deriveKeys(accountIndex);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to get keys for account';
        setError(errorMessage);
        return null;
      }
    },
    [deriveKeys]
  );

  const getCashuMnemonicForAccount = useCallback(
    async (accountIndex: number): Promise<string | null> => {
      try {
        return await deriveCashuMnemonic(accountIndex);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get cashu mnemonic for account';
        setError(errorMessage);
        return null;
      }
    },
    [deriveCashuMnemonic]
  );

  const refresh = useCallback(async () => {
    if (!mnemonic) return;

    try {
      setIsLoading(true);
      setError(null);

      // Clear cache and rederive default keys
      setCachedKeys(new Map());
      setCachedCashuMnemonics(new Map());
      const defaultKeys = await deriveKeys(defaultAccountIndex);
      const defaultCashuMnemonic = await deriveCashuMnemonic(defaultAccountIndex);
      setKeys(defaultKeys);
      setCashuMnemonic(defaultCashuMnemonic);

      // Update account index and cashu mnemonic in CocoManager
      CocoManager.setAccountIndex(defaultAccountIndex);
      if (defaultCashuMnemonic) {
        CocoManager.setCashuMnemonic(defaultCashuMnemonic);
      }

      setIsReady(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh keys';
      setError(errorMessage);
      console.error('Failed to refresh Nostr keys:', err);
    } finally {
      setIsLoading(false);
    }
  }, [mnemonic, defaultAccountIndex, deriveKeys, deriveCashuMnemonic]);

  // Initialize default keys when mnemonic is available, or generate one if none exists
  useEffect(() => {
    if (mnemonicLoading) return;
    if (!stage.canStart) return;
    if (hasStarted.current) return;
    hasStarted.current = true;

    const initializeKeys = async () => {
      try {
        initLog('NostrKeys', 'initializeKeys starting');
        setIsLoading(true);
        setError(null);

        let mnemonicToUse = mnemonic;
        initLog('NostrKeys', `mnemonic from SecureStore: ${mnemonic ? 'exists' : 'null'}`);

        // If no mnemonic from secure storage, try Redux fallback first
        if (!mnemonicToUse) {
          stage.log('Checking for existing wallet...');
          initLog('NostrKeys', 'checking Redux for mnemonic...');
          mnemonicToUse = getMnemonicFromRedux();

          if (mnemonicToUse) {
            initLog('NostrKeys', 'found mnemonic in Redux — migrating to SecureStore');
            stage.log('Migrating wallet to secure storage...');

            try {
              const { storeMnemonic } = await import('../helper/secureStorage');
              const stored = await storeMnemonic(mnemonicToUse);
              initLog('NostrKeys', `storeMnemonic result: ${stored}`);
            } catch (error) {
              initLog('NostrKeys', `storeMnemonic error: ${error}`);
            }
          } else {
            initLog('NostrKeys', 'no mnemonic in Redux either');
          }
        } else {
          stage.log('Initializing keys...');
        }

        if (!mnemonicToUse) {
          stage.log('Generating new wallet...');
          initLog('NostrKeys', 'generating new mnemonic...');
          mnemonicToUse = await ensureMnemonicExists();
          initLog('NostrKeys', `ensureMnemonicExists done: ${!!mnemonicToUse}`);

          if (!mnemonicToUse) {
            throw new Error('Failed to generate or retrieve mnemonic');
          }
        }

        initLog('NostrKeys', 'hashing mnemonic...');
        const mHash = hashMnemonic(mnemonicToUse);
        initLog('NostrKeys', 'mnemonic hashed');
        let defaultKeys: NostrKeys | null = null;
        let defaultCashuMnemonic: string | null = null;

        // Try loading cached keys from SecureStore (fast path)
        initLog('NostrKeys', 'reading cached keys from SecureStore...');
        const [cachedDerived, cachedCashu] = await Promise.all([
          retrieveDerivedKeys(defaultAccountIndex),
          retrieveCashuMnemonic(defaultAccountIndex),
        ]);
        initLog('NostrKeys', `cache read done — derived=${!!cachedDerived} cashu=${!!cachedCashu}`);

        const cacheValid =
          cachedDerived?.mnemonicHash === mHash && cachedCashu?.mnemonicHash === mHash;
        initLog('NostrKeys', `cache valid: ${cacheValid}`);

        if (cacheValid && cachedDerived && cachedCashu) {
          stage.log('Loading cached keys...');
          initLog('NostrKeys', 'using cached keys (fast path)');
          defaultKeys = {
            npub: cachedDerived.npub,
            nsec: cachedDerived.nsec,
            pubkey: cachedDerived.pubkey,
            privateKey: hexToBytes(cachedDerived.privateKeyHex),
          };
          defaultCashuMnemonic = cachedCashu.value;
        } else {
          // Derive from scratch and persist to SecureStore
          stage.log('Deriving keys...');
          initLog('NostrKeys', 'cache miss — deriving NIP-06 keys...');

          const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
            mnemonicToUse,
            undefined,
            defaultAccountIndex
          );
          initLog('NostrKeys', 'NIP-06 accountFromSeedWords done');
          const nsec = nip19.nsecEncode(sk);
          const npub = nip19.npubEncode(pk);
          defaultKeys = { npub, nsec, pubkey: pk, privateKey: sk };
          initLog('NostrKeys', 'nip19 encode done');

          initLog('NostrKeys', 'deriving Cashu mnemonic (BIP32)...');
          const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonicToUse));
          const DERIVATION_PATH = `m/44'/129372'`;
          const path = `${DERIVATION_PATH}/0'/${defaultAccountIndex}'/0/0`;
          const seed = root.derive(path);
          defaultCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey as Buffer, wordlist);
          initLog('NostrKeys', 'Cashu mnemonic derived');

          // Persist to SecureStore in the background (don't block)
          const cachePayload: CachedDerivedKeys = {
            npub,
            nsec,
            pubkey: pk,
            privateKeyHex: bytesToHex(sk),
            mnemonicHash: mHash,
          };
          Promise.all([
            storeDerivedKeys(defaultAccountIndex, cachePayload),
            storeCashuMnemonic(defaultAccountIndex, defaultCashuMnemonic, mHash),
          ]).catch((e) => initLog('NostrKeys', `cache write failed: ${e}`));
        }

        initLog('NostrKeys', 'setting keys in state...');
        setKeys(defaultKeys);
        setCashuMnemonic(defaultCashuMnemonic);

        initLog('NostrKeys', 'setting CocoManager account index & cashu mnemonic...');
        CocoManager.setAccountIndex(defaultAccountIndex);
        if (defaultCashuMnemonic) {
          CocoManager.setCashuMnemonic(defaultCashuMnemonic);
        }
        initLog('NostrKeys', 'CocoManager configured');

        if (defaultKeys?.pubkey) {
          initLog('NostrKeys', 'adding profile to profileStore...');
          useProfileStore.getState().addProfile(defaultAccountIndex, defaultKeys.pubkey);
        }

        setIsReady(true);
        stage.complete();
        initLog('NostrKeys', 'stage complete');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to initialize keys';
        setError(errorMessage);
        stage.error(errorMessage);
        initLog('NostrKeys', `ERROR: ${err}`);
      } finally {
        setIsLoading(false);
      }
    };

    initializeKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mnemonic, mnemonicLoading, stage.canStart]);

  // Update error state based on mnemonic error
  useEffect(() => {
    if (mnemonicError) {
      setError(mnemonicError);
    }
  }, [mnemonicError]);

  const contextValue: NostrKeysContextValue = {
    keys,
    cashuMnemonic,
    isReady,
    isLoading: isLoading || mnemonicLoading,
    error,
    refresh,
    getKeysForAccount,
    getCashuMnemonicForAccount,
  };

  // Loading UI is now handled by InitializationScreen
  // Only render children when ready
  if (!isReady || isLoading) {
    return <NostrKeysContext.Provider value={contextValue}>{null}</NostrKeysContext.Provider>;
  }

  return <NostrKeysContext.Provider value={contextValue}>{children}</NostrKeysContext.Provider>;
}
