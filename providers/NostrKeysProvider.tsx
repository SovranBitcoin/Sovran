import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from 'react';
import { View } from 'components/ui/View';
import { useMnemonic } from 'hooks/useSecureStore';
import { ensureMnemonicExists } from 'helper/secureStorage';
import * as nip06 from 'nostr-tools/nip06';
import { nip19 } from 'nostr-tools';
import { Text } from '@/components/ui/Text';
import Image from 'components/ui/Image';
import { VideoScreen } from 'components/ui/VideoPlayer';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { CocoProvider } from 'helper/coco';
import { CocoManager } from 'helper/coco/manager';

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
  const { value: mnemonic, loading: mnemonicLoading, error: mnemonicError } = useMnemonic();
  const [keys, setKeys] = useState<NostrKeys | null>(null);
  const [cashuMnemonic, setCashuMnemonic] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedKeys, setCachedKeys] = useState<Map<number, NostrKeys>>(new Map());
  const [cachedCashuMnemonics, setCachedCashuMnemonics] = useState<Map<number, string>>(new Map());

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
        const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
          mnemonic,
          undefined,
          accountIndex
        );

        // Encode the keys
        const nsec = nip19.nsecEncode(sk);
        const npub = nip19.npubEncode(pk);

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

      // Update the cashu mnemonic in CocoManager
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

    const initializeKeys = async () => {
      try {
        setIsLoading(true);
        setError(null);

        let mnemonicToUse = mnemonic;

        // If no mnemonic exists, generate a new one
        if (!mnemonicToUse) {
          console.log('No mnemonic found, generating new one...');
          mnemonicToUse = await ensureMnemonicExists();

          if (!mnemonicToUse) {
            throw new Error('Failed to generate or retrieve mnemonic');
          }
        }

        let defaultKeys: NostrKeys | null = null;
        let defaultCashuMnemonic: string | null = null;

        // Temporarily update the mnemonic for derivation
        const originalMnemonic = mnemonic;
        if (mnemonicToUse !== originalMnemonic) {
          // We need to derive keys with the new mnemonic
          const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
            mnemonicToUse,
            undefined,
            defaultAccountIndex
          );
          const nsec = nip19.nsecEncode(sk);
          const npub = nip19.npubEncode(pk);
          defaultKeys = { npub, nsec, pubkey: pk, privateKey: sk };

          // Derive cashu mnemonic
          const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonicToUse));
          const DERIVATION_PATH = `m/44'/129372'`;
          const path = `${DERIVATION_PATH}/0'/${defaultAccountIndex}'/0/0`;
          const seed = root.derive(path);
          defaultCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey as Buffer, wordlist);
        } else {
          defaultKeys = await deriveKeys(defaultAccountIndex);
          defaultCashuMnemonic = await deriveCashuMnemonic(defaultAccountIndex);
        }

        setKeys(defaultKeys);
        setCashuMnemonic(defaultCashuMnemonic);

        // Set the cashu mnemonic in CocoManager for simplified seedGetter
        if (defaultCashuMnemonic) {
          CocoManager.setCashuMnemonic(defaultCashuMnemonic);
        }

        setIsReady(true);
        console.log('NostrKeysProvider initialization complete');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to initialize keys';
        setError(errorMessage);
        console.error('Failed to initialize Nostr keys:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initializeKeys();
  }, [mnemonic, mnemonicLoading, defaultAccountIndex, deriveKeys, deriveCashuMnemonic]);

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

  // Show loading state while initializing
  if (!isReady || isLoading) {
    return (
      <NostrKeysContext.Provider value={contextValue}>
        <View
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            flexDirection: 'column',
            gap: 16,
          }}>
          <View style={{ position: 'relative', width: 300, height: 300 }}>
            <Image
              style={{
                width: 150,
                height: 150,
                position: 'absolute',
                bottom: 10,
                left: 150,
                transform: [{ translateX: -75 }, { rotate: '10deg' }],
                zIndex: 1,
              }}
              source={require('../assets/images/initializing.png')}
            />
            <VideoScreen
              style={
                {
                  width: 300,
                  height: 300,
                  backgroundColor: 'black',
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                } as any
              }
              videoSource={require('../assets/videos/coco.mp4')}
              muted={true}
            />
          </View>
          <Text style={{ color: 'white', fontSize: 16, textAlign: 'center' }}>
            {mnemonic ? 'Initializing keys...' : 'Generating new wallet...'}
          </Text>
          {error && <Text style={{ color: 'red' }}>Error: {error}</Text>}
        </View>
      </NostrKeysContext.Provider>
    );
  }

  return (
    <NostrKeysContext.Provider value={contextValue}>
      <CocoProvider>{children}</CocoProvider>
    </NostrKeysContext.Provider>
  );
}
