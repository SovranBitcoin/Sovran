import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { showMessage } from 'helper/popup/popups';
import { useProcessPaymentString } from './useProcessPaymentString';

export const useDeeplink = () => {
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const url = Linking.useURL();

  const { processPaymentString } = useProcessPaymentString({
    unit: 'sat',
    selectedMint,
    isFocused: true,
  });

  useEffect(() => {
    // bail out early if we don’t have a URL or the user isn’t fully loaded
    if (!url || !currentProfile.pubkey) {
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
          showMessage(
            error instanceof Error ? error.message : 'Unknown error',
            {},
            { emoji: '🚨' }
          );
        }
      }
    })();
  }, [url, currentProfile.pubkey, selectedMint, processPaymentString]);
};
