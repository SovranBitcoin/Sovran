import React, { useEffect, useState } from 'react';
import { useMintStore } from './stores/mintStore';
import { useNostrKeysContext } from './providers/NostrKeysProvider';

/**
 * Debug component to test mint persistence
 * Add this temporarily to your main screen to see what's happening
 */
export const DebugMintPersistence = () => {
  const { keys } = useNostrKeysContext();
  const getAllSelectedMints = useMintStore((state) => state.getAllSelectedMints);
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const debugStorage = useMintStore((state) => state.debugStorage);
  const [debugInfo, setDebugInfo] = useState<any>({});

  useEffect(() => {
    const runDebug = async () => {
      const debug = {
        timestamp: new Date().toISOString(),
        hasKeys: !!keys,
        pubkey: keys?.pubkey,
        allStoredMints: getAllSelectedMints(),
        selectedMintForCurrentPubkey: keys?.pubkey ? getSelectedMint(keys.pubkey) : null,
        rawStorageData: await debugStorage(),
      };

      setDebugInfo(debug);

      console.log('=== MINT PERSISTENCE DEBUG ===');
      console.log('Timestamp:', debug.timestamp);
      console.log('Has keys:', debug.hasKeys);
      console.log('Current pubkey:', debug.pubkey);
      console.log('All stored mints:', debug.allStoredMints);
      console.log('Selected mint for current pubkey:', debug.selectedMintForCurrentPubkey);
      console.log('Raw storage data:', debug.rawStorageData);
      console.log('=== END DEBUG ===');
    };

    runDebug();
  }, [keys?.pubkey, getAllSelectedMints, getSelectedMint, debugStorage]);

  // Also log when the component mounts
  useEffect(() => {
    console.log('DebugMintPersistence: Component mounted');
  }, []);

  return null; // This component doesn't render anything
};
