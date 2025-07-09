import { useEffect, useState } from 'react';
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
  const [urDecoder, setUrDecoder] = useState<URDecoder>(new URDecoder());
  const navigation = useNavigation();
  const url = Linking.useURL();

  useEffect(() => {
    (async () => {
      if (url && currentProfile.pubkey) {
        const parsed = Linking.parse(url);
        if (
          ['cashu', 'sovran'].includes(parsed.scheme) &&
          parsed.hostname !== 'expo-development-client' &&
          parsed.hostname
        ) {
          try {
            const res = await barcodeHandler({
              scanning: { data: parsed.hostname },
              navigation,
              urDecoder,
              unit: 'sat',
              selectedMint,
              setLoading: () => { },
            });
            if (res.isErr()) {
              showMessage(res.error, {}, { emoji: '🚨' });
            }
          } catch (err) {
            // ignore
          }
        }
      }
    })();
  }, [url, currentProfile.pubkey]);

  // useEffect(() => {
  //   const urDecoder = new URDecoder();

  //   const supportedSchemes = ['test://', 'sovran://', 'cashu://'];

  //   const handleUrl = async ({ url }: { url: string }) => {
  //     if (!url) return;
  //     const scheme = supportedSchemes.find((s) => url.startsWith(s));
  //     if (!scheme) return;
  //     const data = decodeURIComponent(url.replace(scheme, ''));
  //     await barcodeHandler({
  //       scanning: { data },
  //       navigation,
  //       urDecoder,
  //       unit: 'sat',
  //       selectedMint,
  //       setLoading: () => { },
  //     });
  //   };

  //   const subscription = Linking.addEventListener('url', handleUrl);

  //   Linking.getInitialURL().then((url) => {
  //     if (url) handleUrl({ url });
  //   });

  //   return () => subscription.remove();
  // }, [navigation, selectedMint]);
};
