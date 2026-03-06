import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { deeplinkFailedPopup } from '@/shared/lib/popup';
import { useProcessPaymentString } from '@/features/send/hooks/useProcessPaymentString';

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

      const isOurScheme = scheme === 'cashu' || scheme === 'sovran';
      if (!isOurScheme) return;

      const isRouterHandled = hostname === 'camera';
      if (isRouterHandled) return;

      const isValidHost = hostname !== null && hostname !== 'expo-development-client';
      if (isValidHost) {
        try {
          await processPaymentString({ data: hostname, type: 'deeplink' });
        } catch (error) {
          deeplinkFailedPopup({ text: error instanceof Error ? error.message : undefined });
        }
      }
    })();
  }, [url, keys?.pubkey, selectedMint, processPaymentString]);
};
