import React, { createContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { NDKCacheAdapterSqlite, NDKPrivateKeySigner, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { relays } from '@/shared/ndk';
import { useInitializationStage } from './InitializationProvider';
import { useNostrKeysContext } from './NostrKeysProvider';
import { initLog, nostrLog } from '@/shared/lib/logger';

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
    initLog('NDK', 'starting NDK initialization...');
    nostrLog.info('provider.ndk.init_start', { relayCount: relays.length, relays, accountIndex: activeAccountIndex });

    stage.log('Initializing NDK with signer...');

    try {
      // Initialize NDK with cache adapter, relays, and signer
      // @ts-ignore - initializeNDK expects slightly different types
      initializeNDK({
        cacheAdapter,
        explicitRelayUrls: relays,
        signer: new NDKPrivateKeySigner(nostrKeys.privateKey),
      });

      initLog('NDK', 'initializeNDK() returned');
      nostrLog.info('provider.ndk.init_complete', { relayCount: relays.length });
      setIsInitialized(true);
      stage.log('Nostr initialized');
      stage.complete();
      initLog('NDK', 'stage complete');
    } catch (err) {
      nostrLog.error('provider.ndk.init_failed', { error: err instanceof Error ? err : new Error(String(err)) });
      stage.error(err instanceof Error ? err.message : 'NDK initialization failed');
    }
  }, [stage.canStart, initializeNDK, nostrKeys?.privateKey, stage]);

  return <NostrNDKContext.Provider value={{ isInitialized }}>{children}</NostrNDKContext.Provider>;
}
