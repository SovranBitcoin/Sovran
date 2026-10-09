import { KeyRecoveryScreen } from '@/shared/blocks/KeyRecoveryScreen';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import {
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
  useMnemonic,
} from '@/shared/lib/nostr/secureStorage';
import {
  deriveNostrKeys,
  deriveCashuMnemonic as deriveCashuMnemonicPure,
} from '@/shared/lib/nostr/keyDerivation';
import { loadAccountKeys, type NostrKeys } from '@/shared/lib/nostr/loadAccountKeys';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useInitializationStage } from './InitializationProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { log, initLog, initPhase, redactError, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'NostrKeysProvider loaded');

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

/**
 * Re-provides the NostrKeys context across a portal boundary. heroui-native
 * portals (e.g. `BottomSheet.Portal`) render their children inside the
 * `PortalHost` mounted in `HeroUINativeProvider` — which sits ABOVE the
 * account-scoped providers — so portaled content loses this context. Capture
 * the value with `useNostrKeysContext()` at the declaration site (inside the
 * provider) and pass it here to re-provide it inside the portal. Same pattern
 * heroui's own `BottomSheetPortal` uses for its animation contexts.
 */
export function NostrKeysContextBridge({
  value,
  children,
}: {
  value: NostrKeysContextValue;
  children: ReactNode;
}) {
  return <NostrKeysContext.Provider value={value}>{children}</NostrKeysContext.Provider>;
}

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
  const locked = useSecureStoreState((s) => s.secureStoreState === 'locked');
  const stage = useInitializationStage('nostr', {
    message: 'Initializing keys...',
    dependsOn: ['global-migrations'],
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
  // Startup outlives the mount that began it: a remount for another account
  // must not have this one's index and wallet phrase written into the wallet
  // core, or its profile row added, after the fact.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
          log.error('nostr.keys.derive_failed', { error: redactError(err) });
          throw err;
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
          log.error('nostr.keys.cashu_mnemonic_failed', { error: redactError(err) });
          throw err;
        } finally {
          inFlightCashu.current.delete(accountIndex);
        }
      })();
      inFlightCashu.current.set(accountIndex, work);
      return work;
    },
    [getMnemonicForDerivation]
  );

  // `null` means no root mnemonic exists yet; a derivation failure rejects with
  // the original error so callers (the profile orchestrator) can tell the two
  // apart. `error` state only carries display text for KeyRecoveryScreen.
  const getKeysForAccount = useCallback(
    async (accountIndex: number): Promise<NostrKeys | null> => {
      try {
        return await deriveKeys(accountIndex);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get keys for account');
        throw err;
      }
    },
    [deriveKeys]
  );

  const getCashuMnemonicForAccount = useCallback(
    async (accountIndex: number): Promise<string | null> => {
      try {
        return await deriveCashuMnemonic(accountIndex);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get cashu mnemonic for account');
        throw err;
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
      if (!mounted.current) return;
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
    if (mnemonicLoading || locked) return;
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

        const loaded = await loadAccountKeys({
          mnemonic: mnemonicToUse,
          accountIndex: defaultAccountIndex,
          onProgress: stage.log,
          shouldContinue: () => mounted.current,
        });
        if (!loaded) return;
        if (!mounted.current) {
          log.info('nostr.keys.init_abandoned', { defaultAccountIndex });
          return;
        }
        const { keys: defaultKeys, cashuMnemonic: defaultCashuMnemonic, isImported } = loaded;

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
          if (!useProfileStore.getState().addProfile(defaultAccountIndex, defaultKeys.pubkey)) {
            // Boot keeps going: the keys are derived and the wallet works, it
            // is only the profile row that is missing. Refusing here would
            // mean a full list AND this account absent from it, which the
            // switch paths cannot produce.
            log.warn('nostr.keys.profile_add_refused', { defaultAccountIndex });
          }
        }

        setIsReady(true);
        stage.complete();
        initLog('NostrKeys', 'stage complete');
      } catch (err) {
        // The stage is keyed by id, not by mount: reporting a failure after
        // unmount would mark the remounted provider's stage as failed.
        if (!mounted.current) return;
        log.error('nostr.keys.init_failed', { error: redactError(err) });
        // Display text for the init screen and KeyRecoveryScreen.
        const errorMessage = err instanceof Error ? err.message : 'Failed to initialize keys';
        setError(errorMessage);
        stage.error(errorMessage);
      } finally {
        if (mounted.current) setIsLoading(false);
      }
    };

    void initializeKeys();
    // `stage` is memoised (moves only when `canStart` flips). `hasStarted`
    // keeps this once-only regardless, so listing every value the body reads
    // costs nothing and keeps the dependency set honest.
  }, [mnemonic, mnemonicLoading, locked, stage, refreshMnemonic, defaultAccountIndex]);

  // Non-blocking: once keys are ready, refresh the user's own-account profiles
  // (kind-0 + follower/following counts) so the drawer/account switcher stay
  // fresh. Runs after interactions so it never holds the splash. Own accounts
  // only — not the follow graph.
  const ownProfileSyncedRef = useRef(false);
  useEffect(() => {
    if (!isReady || ownProfileSyncedRef.current) return;
    ownProfileSyncedRef.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void import('@/shared/lib/profile/ownProfileSync')
        .then(({ syncOwnProfiles }) => syncOwnProfiles())
        .catch((e) => initLog('NostrKeys', `syncOwnProfiles failed: ${e}`));
    });
    return () => task.cancel();
  }, [isReady]);

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

  if (locked || (error && !isReady)) {
    return (
      <NostrKeysContext.Provider value={contextValue}>
        <KeyRecoveryScreen locked={locked} />
      </NostrKeysContext.Provider>
    );
  }

  // Loading UI is now handled by InitializationScreen
  // Only render children when ready
  if (!isReady || isLoading) {
    return <NostrKeysContext.Provider value={contextValue}>{null}</NostrKeysContext.Provider>;
  }

  return <NostrKeysContext.Provider value={contextValue}>{children}</NostrKeysContext.Provider>;
}
