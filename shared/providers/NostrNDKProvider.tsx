import React, { createContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { NDKCacheAdapterSqlite, NDKPrivateKeySigner, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { relays } from '@/shared/ndk';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useInitializationStage } from './InitializationProvider';
import { useNostrKeysContext } from './NostrKeysProvider';
import { initLog } from '@/shared/lib/initTiming';

interface NostrNDKContextValue {
  isInitialized: boolean;
}

const NostrNDKContext = createContext<NostrNDKContextValue>({
  isInitialized: false,
});

interface NostrNDKProviderProps {
  children: ReactNode;
}

export function NostrNDKProvider({ children }: NostrNDKProviderProps) {
  const { init: initializeNDK } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
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
    if (!stage.canStart) return;
    if (!nostrKeys?.privateKey) return;

    hasInitialized.current = true;
    initLog('NDK', 'starting NDK initialization...');

    stage.log('Initializing NDK with signer...');

    // Initialize NDK with cache adapter, relays, and signer
    // @ts-ignore - initializeNDK expects slightly different types
    initializeNDK({
      cacheAdapter,
      explicitRelayUrls: relays,
      signer: new NDKPrivateKeySigner(nostrKeys.privateKey),
    });

    initLog('NDK', 'initializeNDK() returned');
    setIsInitialized(true);
    stage.log('Nostr initialized');
    stage.complete();
    initLog('NDK', 'stage complete');
  }, [stage.canStart, initializeNDK, nostrKeys?.privateKey, stage]);

  return <NostrNDKContext.Provider value={{ isInitialized }}>{children}</NostrNDKContext.Provider>;
}
