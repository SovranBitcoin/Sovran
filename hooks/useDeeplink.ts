import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useMintStore } from '../stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { popup } from '@/helper/popup';
import { useProcessPaymentString } from './coco/useProcessPaymentString';

export const useDeeplink = () => {
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const url = Linking.useURL();

  const { processPaymentString } = useProcessPaymentString({
    unit: 'sat',
    selectedMint,
    isFocused: true,
  });

  useEffect(() => {
    // bail out early if we don’t have a URL or the user isn’t fully loaded
    if (!url || !keys?.pubkey) {
      return;
    }

    (async () => {
      const parsed = Linking.parse(url);
      const { scheme, hostname } = parsed;

      // scheme can be null, so check explicitly; hostname can be null, so guard it too
      const isOurScheme = scheme === 'cashu' || scheme === 'sovran';
      const isValidHost = hostname !== null && hostname !== 'expo-development-client';

      if (isOurScheme && isValidHost) {
        // TS knows hostname is string here
        try {
          await processPaymentString({ data: hostname });
        } catch (error) {
          popup({
            message: error instanceof Error ? error.message : 'Unknown error',
            emoji: '🚨',
            type: 'error',
          });
        }
      }
    })();
  }, [url, keys?.pubkey, selectedMint, processPaymentString]);
};
