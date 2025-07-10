import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { barcodeHandler } from 'helper/payment-handler/handlers';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { useNavigation } from 'expo-router';
import { URDecoder } from '@gandlaf21/bc-ur';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { showMessage } from 'helper/popup/popups';

export const useDeeplink = () => {
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const navigation = useNavigation();
  const url = Linking.useURL();

  // Hold a single URDecoder instance across renders
  const urDecoderRef = useRef<URDecoder>(new URDecoder());

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
        const res = await barcodeHandler({
          scanning: { data: hostname },
          navigation,
          urDecoder: urDecoderRef.current,
          unit: 'sat',
          selectedMint,
          setLoading: () => { },
        });

        if (res.isErr()) {
          showMessage(res.error.message, {}, { emoji: '🚨' });
        }
      }
    })();
  }, [
    url,
    currentProfile.pubkey,
    selectedMint,
    navigation,
    // we don’t need urDecoderRef in deps because refs are stable
  ]);
};
