import React, { createContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { NDKCacheAdapterSqlite, NDKPrivateKeySigner, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { relays } from '@/shared/ndk';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
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

  // Hydrate ahead of NDK init — the unwrap useMemo in UserMessagesScreen
  // reads the cache synchronously, so a late hydration would race the
  // first mount and force every wrap to re-decrypt.
  useEffect(() => {
    if (!nostrKeys?.pubkey) return;
    void giftWrapCache.cache.hydrate(nostrKeys.pubkey);
    void nip04Cache.hydrate(nostrKeys.pubkey);
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

    hasInitialized.current = true;
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
        initPhaseSync('NDK.initializeNDK', () => {
          // @ts-ignore - initializeNDK expects slightly different types
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
    // NOTE: `stage` is intentionally excluded from deps. `useInitializationStage`
    // returns a fresh object each render, so including it would re-run this
    // effect on every render and the cleanup would clearTimeout the deferred
    // NDK init before it ever fires — leaving the app with NDK never
    // initialized and every subscription empty. The `hasInitialized` ref
    // guards against double-firing, and `stage.canStart` (primitive) covers
    // the readiness transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.canStart, initializeNDK, nostrKeys?.privateKey]);

  return <NostrNDKContext.Provider value={{ isInitialized }}>{children}</NostrNDKContext.Provider>;
}
