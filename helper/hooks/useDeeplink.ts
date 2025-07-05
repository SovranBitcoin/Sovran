import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from 'expo-router';
import { URDecoder } from '@gandlaf21/bc-ur';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { barcodeHandler } from 'helper/payment-handler/handlers';

export const useDeeplink = () => {
  const navigation = useNavigation();
  const selectedMint = useSelector(memoizedGetSelectedMint);

  useEffect(() => {
    const urDecoder = new URDecoder();

    const handleUrl = async ({ url }: { url: string }) => {
      if (!url || !url.startsWith('cashu://')) return;
      const data = decodeURIComponent(url.replace('cashu://', ''));
      await barcodeHandler({
        scanning: { data },
        navigation,
        urDecoder,
        unit: 'sat',
        selectedMint,
        setLoading: () => { },
      });
    };

    const subscription = Linking.addEventListener('url', handleUrl);

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    return () => subscription.remove();
  }, [navigation, selectedMint]);
};
