import React from 'react';
import { StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { getMeltQuote } from 'components/cashu';
import { useNavigation } from 'expo-router';
import { useSelector } from 'react-redux';
import { useBitrefill } from 'helper/redux/bitrefill';
import { store } from 'helper/redux/store';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { View } from 'components/common/View';
import { greys } from 'helper/colors';

const BITREFILL_URL = 'https://embed.bitrefill.com';
const BITREFILL_NOSTR_PUBKEY = 'df865ef4830496b501eebd88377c90f521469d47c53997300e225aab1b29b264';

export const DEFAULT_MINT_URL = () => {
  const state = store.getState();
  const currentProfileId = state.nostr?.currentProfile?.id;
  const profileProofs = state.cashu?.profiles?.[currentProfileId]?.proofs;
  const selectedMint = state.cashu?.profiles?.[currentProfileId]?.selectedMint;

  // Return selected mint if available
  if (selectedMint) return selectedMint;

  // Otherwise find mint with largest sum
  if (profileProofs) {
    const maxKey = findKeyWithLargestSum(profileProofs);
    if (maxKey) return maxKey;
  }

  // Default fallback
  return 'https://mint.lnvoltz.com';
};

function findKeyWithLargestSum(obj) {
  let maxKey = null;
  let maxSum = 0;

  for (let key in obj) {
    if (Array.isArray(obj[key])) {
      const currentSum = obj[key].reduce((sum, item) => sum + (item.amount || 0), 0);
      if (currentSum > maxSum) {
        maxSum = currentSum;
        maxKey = key;
      }
    }
  }

  return maxKey;
}

function BitrefillWidget({ url = BITREFILL_URL }) {
  const { events, setEvents } = useBitrefill();
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const { product, amount, email } = useTypedRoute();
  const config = {
    ...(amount && { value: amount }),
    theme,
    paymentMethods: ['lightning'],
    showPaymentInfo: false,
    utm_source: 'bitrefill_demo',
    ...(email && { email }),
  };

  const handleMessage = async (e) => {
    const data = JSON.parse(e.nativeEvent.data);
    const newEvent = {
      ...data,
      date: new Date().toISOString(),
    };

    setEvents([...events, newEvent]);

    if (data.event === 'payment_intent') {
      const { paymentAddress } = data;
      const mintUrl = memoizedGetSelectedMint(store.getState());

      const meltQuote = await getMeltQuote({
        pr: paymentAddress,
        unit: 'sat',
        mintUrl,
      });

      navigation.navigate('lightningSendConfirmation', {
        pr: paymentAddress,
        unit: 'sat',
        meltQuote: JSON.stringify(meltQuote),
        pubkey: BITREFILL_NOSTR_PUBKEY,
        email: email,
      });
    }
  };

  const queryParams = new URLSearchParams(config).toString();
  const sourceUri = `${url}/${product?._id}?${queryParams}`;

  return (
    <WebView
      title="Bitrefill"
      source={{ uri: sourceUri }}
      onMessage={handleMessage}
      style={styles.webView}
    />
  );
}

function ModalScreen() {
  return (
    <View
      style={{
        flex: 1,
        height: Dimensions.get('window').height,
        width: Dimensions.get('window').width,
        marginTop: 83,
        backgroundColor: greys('dark')[2300],
      }}>
      <BitrefillWidget />
    </View>
  );
}

const styles = StyleSheet.create({
  webView: {
    width: 'auto',
    height: 'auto',
    backgroundColor: greys('dark')[2300],
  },
});

export default withSheetProvider(ModalScreen);
