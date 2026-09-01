import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { NDKCacheAdapterSqlite, NDKPrivateKeySigner, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { relays } from '@/shared/ndk';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { useOwnRelayListSync } from '@/shared/lib/nostr/outbox/useOwnRelayListSync';
import { useInitializationStage } from './InitializationProvider';
import { useNostrKeysContext } from './NostrKeysProvider';
import { initLog, initPhaseSync, nostrLog, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'NostrNDKProvider loaded');

interface NostrNDKContextValue {
  isInitialized: boolean;
}

const NostrNDKContext = createContext<NostrNDKContextValue>({
  isInitialized: false,
});

/**
 * NDK init readiness (`initializeNDK` runs ~800ms deferred — see the effect
 * below). Consumers that wire NDK-dependent services (e.g. the NIP-46 signer)
 * must gate on `isInitialized`. Outside the provider this returns the context
 * default (`isInitialized: false`), which fails safe.
 */
export function useNostrNDKContext(): NostrNDKContextValue {
  return useContext(NostrNDKContext);
}

interface NostrNDKProviderProps {
  children: ReactNode;
  accountIndex?: number;
}

export function NostrNDKProvider({
  children,
  accountIndex: accountIndexProp,
}: NostrNDKProviderProps) {
  useInitMount('NostrNDKProvider');
  const { init: initializeNDK } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();
  const activeAccountIndex = accountIndexProp ?? 0;
  const hasInitialized = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const cacheAdapter = useMemo(
    () =>
      new NDKCacheAdapterSqlite(activeAccountIndex === 0 ? 'nostr' : `nostr-${activeAccountIndex}`),
    [activeAccountIndex]
  );

  // Non-blocking: starts after all blocking stages complete so it doesn't
  // compete for the JS thread during splash. App is already visible.
  const stage = useInitializationStage('nostr-ndk', {
    message: 'Initializing Nostr...',
    dependsOn: ['coco'],
    blocking: false,
  });

  // Hydrate the NIP-17 unwrap cache ahead of NDK init — the DM thread/contacts
  // decrypt path reads it synchronously, so a late hydration would race the
  // first fetch and force every wrap to re-decrypt.
  useEffect(() => {
    if (!nostrKeys?.pubkey) return;
    void giftWrapCache.cache.hydrate(nostrKeys.pubkey);
  }, [nostrKeys?.pubkey]);

  useEffect(() => {
    if (hasInitialized.current) return;
    if (!stage.canStart) {
      nostrLog.debug('provider.ndk.waiting', { reason: 'stage_not_ready' });
      return;
    }
    if (!nostrKeys?.privateKey) {
      nostrLog.debug('provider.ndk.waiting', { reason: 'no_private_key' });
      return;
    }

    initLog('NDK', 'queued — waiting for interactions to settle');
    nostrLog.info('provider.ndk.init_start', {
      relayCount: relays.length,
      relays,
      accountIndex: activeAccountIndex,
    });

    stage.log('Initializing NDK with signer...');

    // `initializeNDK` runs ~316ms synchronously on the JS thread (relay
    // setup, signer creation, NDK pool wiring). Holding the JS thread that
    // long during the splash morph stalls the morph animation, so we defer
    // it briefly. We *don't* use `InteractionManager.runAfterInteractions`
    // here because the splash morph + wallet entrance spring register as
    // long-running animations and the callback would never fire in some
    // configurations — NDK would silently never initialize, breaking every
    // downstream NDK subscription (NIP-04 DMs, kind-0 profiles, feed
    // events). A plain `setTimeout` runs unconditionally after the
    // specified delay, regardless of in-flight animations.
    const NDK_INIT_DEFER_MS = 800;
    const timeoutId = setTimeout(() => {
      try {
        // Claim the once-only guard here, not before the timer. Set earlier, a
        // re-run inside the 800 ms window cancelled the pending init via the
        // cleanup below and then bailed on an already-true guard, leaving NDK
        // permanently uninitialized and every subscription empty.
        hasInitialized.current = true;
        initPhaseSync('NDK.initializeNDK', () => {
          // ndk-mobile's InitNDKParams requires a `settingsStore` we deliberately
          // don't provide (Sovran owns its own settings persistence); the lib
          // tolerates its absence at runtime. Suppressed rather than passing a
          // fake store.
          // @ts-expect-error - InitNDKParams demands settingsStore; intentionally omitted
          initializeNDK({
            cacheAdapter,
            explicitRelayUrls: relays,
            signer: new NDKPrivateKeySigner(nostrKeys.privateKey),
          });
        });

        nostrLog.info('provider.ndk.init_complete', { relayCount: relays.length });
        setIsInitialized(true);
        stage.log('Nostr initialized');
        stage.complete();
        initLog('NDK', 'stage complete');
      } catch (err) {
        nostrLog.error('provider.ndk.init_failed', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        stage.error(err instanceof Error ? err.message : 'NDK initialization failed');
      }
    }, NDK_INIT_DEFER_MS);

    return () => {
      clearTimeout(timeoutId);
    };
    // `stage` is safe to depend on: `useInitializationStage` memoises it, so it
    // changes only when `canStart` flips — never per render, which is what
    // would otherwise clearTimeout the deferred init before it ever fired.
  }, [stage, initializeNDK, nostrKeys?.privateKey, activeAccountIndex, cacheAdapter]);

  // Ingest the active profile's NIP-65 relay list (or first-run-publish the
  // defaults) and seed the pool, once NDK is ready. Self-deferred internally.
  useOwnRelayListSync(nostrKeys?.pubkey, isInitialized);

  // Memoized so context consumers (e.g. the NIP-46 signer service) only
  // re-render when readiness actually flips, not on every provider render.
  const contextValue = useMemo(() => ({ isInitialized }), [isInitialized]);

  return <NostrNDKContext.Provider value={contextValue}>{children}</NostrNDKContext.Provider>;
}
