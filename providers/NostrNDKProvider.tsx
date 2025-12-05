import React, { createContext, useEffect, useRef, useState, ReactNode } from 'react';
import { NDKCacheAdapterSqlite, NDKPrivateKeySigner, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { relays } from 'components/ndk';
import { useInitializationStage } from './InitializationProvider';
import { useNostrKeysContext } from './NostrKeysProvider';

// Cache adapter at module level
const cacheAdapter = new NDKCacheAdapterSqlite('nostr');

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
  const hasInitialized = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Register with initialization system, depends on NostrKeysProvider
  const stage = useInitializationStage('nostr-ndk', {
    message: 'Initializing Nostr...',
    dependsOn: ['nostr'], // Depends on NostrKeysProvider
  });

  useEffect(() => {
    if (hasInitialized.current) return;
    if (!stage.canStart) return;
    if (!nostrKeys?.privateKey) return;

    hasInitialized.current = true;

    stage.log('Initializing NDK with signer...');

    // Initialize NDK with cache adapter, relays, and signer
    // @ts-ignore - initializeNDK expects slightly different types
    initializeNDK({
      cacheAdapter,
      explicitRelayUrls: relays,
      signer: new NDKPrivateKeySigner(nostrKeys.privateKey),
    });

    setIsInitialized(true);
    stage.log('Nostr initialized');
    stage.complete();
  }, [stage.canStart, initializeNDK, nostrKeys?.privateKey, stage]);

  return <NostrNDKContext.Provider value={{ isInitialized }}>{children}</NostrNDKContext.Provider>;
}
