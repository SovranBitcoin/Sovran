import 'app/global';
import { memo, useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { nip19 } from 'nostr-tools';
import { ImageBackground } from 'expo-image';
import { View } from 'components/common/Themed';
import { Transactions } from 'components/layout/Transactions';
import { receiveEcash } from 'components/cashu';
import { NCSDK } from 'helper/third-party/cashu-address-sdk-rn/sdk';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import Welcome from 'app/onboard/welcome';
import TermsConditionsScreen from 'app/settings/terms';
import { AccountPagerView } from '../../../components/layout/AccountPagerView';

async function getProfile(currentProfile) {
  const sk = nip19.decode(currentProfile?.nsec).data;
  const signer = new NsecSigner(sk);
  const sdk = new NCSDK('https://npub.cash', signer);
  const balance = await sdk.getBalance();

  if (balance <= 0) {
    showMessage('no_funds');
    return;
  }

  const token = await sdk.getToken();

  if (token) {
    await receiveEcash({
      token,
      unit: 'sat',
      fromNIP05: `${currentProfile?.npub}@npub.cash`,
    });
    showMessage('funds_received', { amount: balance, unit: 'sat' }, { emoji: '🎉' }, () => {});
  }
}

function TabOneScreen({
  currencies = [
    {
      key: 'sat-cashu',
      treasury: 'Personal Treasury',
      unit: 'sat',
      label: 'Bitcoin ecash',
      type: 'ecash',
    },
    {
      key: 'usd-cashu',
      treasury: 'Personal Treasury',
      unit: 'usd',
      label: 'Dollar ecash',
      type: 'ecash',
    },
    {
      key: 'eur-cashu',
      treasury: 'Personal Treasury',
      unit: 'eur',
      label: 'Cashu (eEUR)',
      type: 'ecash',
    },
    {
      key: 'gbp-cashu',
      treasury: 'Personal Treasury',
      unit: 'gbp',
      label: 'Cashu (eGBP)',
      type: 'ecash',
    },
  ],
}) {
  const supportedUnits = ['sat', 'usd', 'eur', 'gbp'];

  const [accounts, setAccounts] = useState([
    ...currencies.filter((u) => supportedUnits.includes(u.unit)),
  ]);
  const [account, setAccount] = useState(accounts[0]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await getProfile(currentProfile);
    setRefreshing(false);
  }, []);

  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const currentProfile = useSelector((state) => state.nostr.currentProfile);
  const settings = useSelector((state) => state.settings.settings);

  if (!settings?.termsAccepted) {
    return (
      <TermsConditionsScreen
        onClose={() => {
          store.dispatch({
            type: 'TERMS_ACCEPTED',
            payload: {
              date: new Date().toISOString(),
            },
          });
        }}
      />
    );
  }

  if (!currentProfile?.pubkey) {
    return <Welcome />;
  }

  return (
    <ImageBackground
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
      }}>
      <SafeAreaView style={styles.safeAreaView}>
        <ScrollView
          style={styles.scrollView}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <AccountPagerView
            accounts={accounts}
            setAccount={setAccount}
            account={account}
            setAccounts={setAccounts}
          />
          <View
            style={{
              margin: 16,
            }}>
            <Transactions days={1} account={account} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    scrollView: {
      marginTop: -38,
      marginBottom: -24,
      backgroundColor: greys(theme)[2300],
    },
    safeAreaView: {
      flex: 1,
      backgroundColor: greys(theme)[2300],
    },
    accountPagerView: {
      display: 'flex',
      height: 300,
      width: '100%',
    },
  });

export default memo(TabOneScreen);
