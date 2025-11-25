import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import NDK from '@nostr-dev-kit/ndk';
import { useNDKInit } from '@nostr-dev-kit/ndk-mobile';
import { relays } from 'components/ndk';
import { useInitializationStage } from './InitializationProvider';

/**
 * Initialize NDK instance with relays
 * Cache adapter disabled temporarily due to version conflicts
 * @returns NDK instance
 */
function createNDKInstance() {
  const ndk = new NDK({
    explicitRelayUrls: relays,
  });
  return ndk;
}

// Create NDK instance at module level (but don't connect yet)
const ndkInstance = createNDKInstance();

interface NostrNDKContextValue {
  ndk: NDK;
  isConnected: boolean;
}

const NostrNDKContext = createContext<NostrNDKContextValue>({
  ndk: ndkInstance,
  isConnected: false,
});

export const useNostrNDK = () => useContext(NostrNDKContext);

interface NostrNDKProviderProps {
  children: ReactNode;
}

export function NostrNDKProvider({ children }: NostrNDKProviderProps) {
  const initializeNDKHook = useNDKInit();
  const isInitialized = useRef(false);

  // Register with initialization system, depends on NostrKeysProvider
  const stage = useInitializationStage('nostr-ndk', {
    message: 'Initializing Nostr...',
    dependsOn: ['nostr'], // Depends on NostrKeysProvider
  });

  useEffect(() => {
    if (isInitialized.current) return;
    if (!stage.canStart) return;

    isInitialized.current = true;

    stage.log('Connecting to Nostr relays...');

    // Connect to relays (async, doesn't block)
    ndkInstance.connect();

    stage.log('Registering NDK hooks...');

    // Register with NDK hooks system
    initializeNDKHook(ndkInstance);

    stage.log('Nostr initialized');
    stage.complete();
  }, [stage.canStart, initializeNDKHook, stage]);

  return (
    <NostrNDKContext.Provider value={{ ndk: ndkInstance, isConnected: true }}>
      {children}
    </NostrNDKContext.Provider>
  );
}

export default NostrNDKProvider;
