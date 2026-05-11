import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { InteractionManager } from 'react-native';
import {
  ensureMnemonicExists,
  retrieveMnemonic,
  retrieveDerivedKeys,
  storeDerivedKeys,
  retrieveCashuMnemonic,
  storeCashuMnemonic,
  retrieveImportedNsec,
  hashMnemonic,
  useMnemonic,
  type CachedDerivedKeys,
} from '@/shared/lib/nostr/secureStorage';
import {
  deriveNostrKeys,
  deriveCashuMnemonic as deriveCashuMnemonicPure,
  deriveCashuMnemonicForImported,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import { nip19, getPublicKey } from 'nostr-tools';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { useInitializationStage } from './InitializationProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { log, initLog, initPhase, redactError, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'NostrKeysProvider loaded');

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

const NostrKeysContext = createContext<NostrKeysContextValue | null>(null);

export const useNostrKeysContext = (): NostrKeysContextValue => {
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
  useInitMount('NostrKeysProvider');
  const stage = useInitializationStage('nostr', {
    message: 'Initializing keys...',
    dependsOn: ['migrations'],
  });
  const {
    value: mnemonic,
    loading: mnemonicLoading,
    error: mnemonicError,
    refresh: refreshMnemonic,
  } = useMnemonic();
  const [keys, setKeys] = useState<NostrKeys | null>(null);
  const [cashuMnemonic, setCashuMnemonic] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Caches are refs, not state: derivation is memoised between calls but is
  // never read in render output. Using state would shake context identity for
  // all 23 consumers on every cache write.
  const cachedKeys = useRef<Map<number, NostrKeys>>(new Map());
  const cachedCashuMnemonics = useRef<Map<number, string>>(new Map());
  // Single-flight dedupe: two concurrent callers for the same accountIndex
  // share one BIP-32 derivation instead of racing.
  const inFlightKeys = useRef<Map<number, Promise<NostrKeys>>>(new Map());
  const inFlightCashu = useRef<Map<number, Promise<string>>>(new Map());
  const hasStarted = useRef(false);

  const getMnemonicForDerivation = useCallback(async (): Promise<string | null> => {
    if (mnemonic) {
      return mnemonic;
    }

    // On a brand-new session, ensureMnemonicExists() may have stored the mnemonic
    // before useMnemonic() refreshes. Read SecureStore directly so profile creation
    // works immediately on first launch after a wipe.
    const storedMnemonic = await retrieveMnemonic();
    if (storedMnemonic) {
      return storedMnemonic;
    }

    return null;
  }, [mnemonic]);

  const deriveKeys = useCallback(
    async (accountIndex: number): Promise<NostrKeys | null> => {
      const rootMnemonic = await getMnemonicForDerivation();
      if (!rootMnemonic) {
        return null;
      }

      const cached = cachedKeys.current.get(accountIndex);
      if (cached) {
        return cached;
      }
      const inflight = inFlightKeys.current.get(accountIndex);
      if (inflight) {
        return inflight;
      }

      const work = (async () => {
        try {
          // initPhase parity with the init path so log-doctor can see on-demand spikes.
          const derivedKeys = await initPhase('NostrKeys.deriveOnDemand', async () =>
            deriveNostrKeys(rootMnemonic, accountIndex)
          );
          cachedKeys.current.set(accountIndex, derivedKeys);
          return derivedKeys;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to derive Nostr keys';
          log.error('nostr.keys.derive_failed', { error: redactError(err) });
          throw new Error(errorMessage);
        } finally {
          inFlightKeys.current.delete(accountIndex);
        }
      })();
      inFlightKeys.current.set(accountIndex, work);
      return work;
    },
    [getMnemonicForDerivation]
  );

  const deriveCashuMnemonic = useCallback(
    async (accountIndex: number): Promise<string | null> => {
      const rootMnemonic = await getMnemonicForDerivation();
      if (!rootMnemonic) {
        return null;
      }

      const cached = cachedCashuMnemonics.current.get(accountIndex);
      if (cached) {
        return cached;
      }
      const inflight = inFlightCashu.current.get(accountIndex);
      if (inflight) {
        return inflight;
      }

      const work = (async () => {
        try {
          const derivedCashuMnemonic = await initPhase('NostrKeys.deriveCashuOnDemand', async () =>
            deriveCashuMnemonicPure(rootMnemonic, accountIndex)
          );
          cachedCashuMnemonics.current.set(accountIndex, derivedCashuMnemonic);
          return derivedCashuMnemonic;
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to derive cashu mnemonic';
          log.error('nostr.keys.cashu_mnemonic_failed', { error: redactError(err) });
          throw new Error(errorMessage);
        } finally {
          inFlightCashu.current.delete(accountIndex);
        }
      })();
      inFlightCashu.current.set(accountIndex, work);
      return work;
    },
    [getMnemonicForDerivation]
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
      cachedKeys.current.clear();
      cachedCashuMnemonics.current.clear();
      const defaultKeys = await deriveKeys(defaultAccountIndex);
      const defaultCashuMnemonic = await deriveCashuMnemonic(defaultAccountIndex);
      setKeys(defaultKeys);
      setCashuMnemonic(defaultCashuMnemonic);

      const refreshProfile = useProfileStore.getState().getActiveProfile();
      CocoManager.setAccountIndex(defaultAccountIndex, refreshProfile?.source === 'imported');
      if (defaultCashuMnemonic) {
        CocoManager.setCashuMnemonic(defaultCashuMnemonic);
      }

      setIsReady(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh keys';
      setError(errorMessage);
      log.error('nostr.keys.refresh_failed', { error: redactError(err) });
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
        stage.log('Initializing keys...');

        if (!mnemonicToUse) {
          stage.log('Generating new wallet...');
          mnemonicToUse = await initPhase('NostrKeys.ensureMnemonic', () => ensureMnemonicExists());
          if (mnemonicToUse) {
            await refreshMnemonic();
          }

          if (!mnemonicToUse) {
            throw new Error('Failed to generate or retrieve mnemonic');
          }
        }

        // Defer CPU-bound derivation until after animations (e.g. drawer close on profile switch)
        await initPhase(
          'NostrKeys.runAfterInteractions',
          () =>
            new Promise<void>((resolve) => {
              InteractionManager.runAfterInteractions(() => resolve());
            })
        );

        const mHash = await initPhase('NostrKeys.hashMnemonic', async () =>
          hashMnemonic(mnemonicToUse!)
        );
        let defaultKeys: NostrKeys | null = null;
        let defaultCashuMnemonic: string | null = null;

        // Check if the active profile is an imported nsec profile
        const activeProfile = useProfileStore.getState().getActiveProfile();
        const isImported = activeProfile?.source === 'imported';

        if (isImported && activeProfile) {
          // ── Imported nsec profile: load identity from SecureStore ──
          stage.log('Loading imported profile...');
          initLog('NostrKeys', 'imported profile — loading nsec from SecureStore');

          const nsecValue = await retrieveImportedNsec(activeProfile.pubkey);
          if (!nsecValue) {
            throw new Error('Imported nsec not found in secure storage');
          }

          const decoded = nip19.decode(nsecValue);
          if (decoded.type !== 'nsec') {
            throw new Error('Stored imported key is not a valid nsec');
          }

          const privateKey = decoded.data;
          const pubkeyHex = getPublicKey(privateKey);

          defaultKeys = {
            npub: nip19.npubEncode(pubkeyHex),
            nsec: nsecValue,
            pubkey: pubkeyHex,
            privateKey,
          };

          const npubNumber = pubkeyToAccountNumber(pubkeyHex);
          initLog(
            'NostrKeys',
            `imported npubNumber=${npubNumber}, deriving Cashu mnemonic (chain 1)...`
          );

          // Try cached Cashu mnemonic first
          const cachedCashu = await retrieveCashuMnemonic(defaultAccountIndex);
          if (cachedCashu?.mnemonicHash === mHash) {
            defaultCashuMnemonic = cachedCashu.value;
          } else {
            defaultCashuMnemonic = deriveCashuMnemonicForImported(mnemonicToUse, npubNumber);
            storeCashuMnemonic(defaultAccountIndex, defaultCashuMnemonic, mHash).catch((e) =>
              initLog('NostrKeys', `imported cashu cache write failed: ${e}`)
            );
          }
          initLog('NostrKeys', 'imported profile keys loaded');
        } else {
          // ── Derived profile: existing NIP-06 derivation path ──
          // Try loading cached keys from SecureStore (fast path)
          const [cachedDerived, cachedCashu] = await initPhase('NostrKeys.cacheRead', () =>
            Promise.all([
              retrieveDerivedKeys(defaultAccountIndex),
              retrieveCashuMnemonic(defaultAccountIndex),
            ])
          );
          initLog(
            'NostrKeys',
            `cache read done — derived=${!!cachedDerived} cashu=${!!cachedCashu}`
          );

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
            stage.log('Deriving keys...');
            defaultKeys = await initPhase('NostrKeys.deriveNip06', async () =>
              deriveNostrKeys(mnemonicToUse!, defaultAccountIndex)
            );

            defaultCashuMnemonic = await initPhase('NostrKeys.deriveCashuMnemonic', async () =>
              deriveCashuMnemonicPure(mnemonicToUse!, defaultAccountIndex)
            );

            const cachePayload: CachedDerivedKeys = {
              npub: defaultKeys.npub,
              nsec: defaultKeys.nsec,
              pubkey: defaultKeys.pubkey,
              privateKeyHex: bytesToHex(defaultKeys.privateKey),
              mnemonicHash: mHash,
            };
            Promise.all([
              storeDerivedKeys(defaultAccountIndex, cachePayload),
              storeCashuMnemonic(defaultAccountIndex, defaultCashuMnemonic, mHash),
            ]).catch((e) => initLog('NostrKeys', `cache write failed: ${e}`));
          }
        }

        initLog('NostrKeys', 'setting keys in state...');
        setKeys(defaultKeys);
        setCashuMnemonic(defaultCashuMnemonic);

        initLog('NostrKeys', 'setting CocoManager account index & cashu mnemonic...');
        CocoManager.setAccountIndex(defaultAccountIndex, isImported);
        if (defaultCashuMnemonic) {
          CocoManager.setCashuMnemonic(defaultCashuMnemonic);
        }
        initLog('NostrKeys', 'CocoManager configured');

        if (defaultKeys?.pubkey && !isImported) {
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

    void initializeKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mnemonic, mnemonicLoading, stage.canStart, refreshMnemonic]);

  // Update error state based on mnemonic error
  useEffect(() => {
    if (mnemonicError) {
      setError(mnemonicError);
    }
  }, [mnemonicError]);

  const contextValue = useMemo<NostrKeysContextValue>(
    () => ({
      keys,
      cashuMnemonic,
      isReady,
      isLoading: isLoading || mnemonicLoading,
      error,
      refresh,
      getKeysForAccount,
      getCashuMnemonicForAccount,
    }),
    [
      keys,
      cashuMnemonic,
      isReady,
      isLoading,
      mnemonicLoading,
      error,
      refresh,
      getKeysForAccount,
      getCashuMnemonicForAccount,
    ]
  );

  // Loading UI is now handled by InitializationScreen
  // Only render children when ready
  if (!isReady || isLoading) {
    return <NostrKeysContext.Provider value={contextValue}>{null}</NostrKeysContext.Provider>;
  }

  return <NostrKeysContext.Provider value={contextValue}>{children}</NostrKeysContext.Provider>;
}
