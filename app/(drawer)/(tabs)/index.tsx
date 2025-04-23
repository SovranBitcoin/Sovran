import 'app/global';
import React, { memo, useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { nip19 } from 'nostr-tools';
import { ImageBackground } from 'expo-image';
import _ from 'lodash';

import { View } from 'components/common/Themed';
import { Transactions } from 'components/layout/Transactions';
import { checkLNPaymentComplete, getRawExpiry, receiveEcash } from 'components/cashu';
import { NCSDK } from 'helper/third-party/cashu-address-sdk-rn/sdk';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import { memoizedGetTransactionByMatcher } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import Welcome from 'app/onboard/welcome';
import { checkProofsSpent } from 'app/ecashSendConfirmation';
import { decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts';
import { runWithAnimationFrame } from 'app/onboard/new';
import TermsConditionsScreen from 'app/settings/terms';
import { AccountPagerView } from '../../../components/layout/AccountPagerView';
import { usePollingPaymentRequest } from 'helper/navigation/hooks/usePollingPaymentRequest';

async function getProfile(currentProfile) {
  const sk = nip19.decode(currentProfile?.nsec).data;
  const signer = new NsecSigner(sk);
  const sdk = new NCSDK('https://npub.cash', signer);
  const balance = await sdk.getBalance();

  if (balance <= 0) {
    return;
  }

  const token = await sdk.getToken();

  if (token) {
    await receiveEcash({
      token,
      unit: 'sat',
      lnurl: `${currentProfile?.npub}@npub.cash`,
    });
    showMessage('funds_received', { amount: balance, unit: 'sat' }, { emoji: '🎉' }, () => {});
  }
}

export const useTransactionStatusPolling = () => {
  const currentProfile = useSelector((state) => state.nostr.currentProfile);

  const newestEcashTx = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) => {
        const ecashTransactions = txs.filter(
          (tx) => tx.transactionType === 'send' && tx.type === 'ecash' && !tx.paid
        );
        return _.maxBy(ecashTransactions, 'date');
      },
    })
  );

  const newestLightningTx = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) =>
        _.maxBy(
          _.filter(
            txs,
            (tx) =>
              tx.type === 'lightning' &&
              !tx.paid &&
              tx.transactionType === 'receive' &&
              tx.request &&
              new Date() < getRawExpiry({ pr: tx.request }) // Check if not expired
          ),
          'date'
        ),
    })
  );

  usePollingPaymentRequest({
    paymentRequest:
      newestLightningTx?.payment_request &&
      decodePaymentRequest(newestLightningTx?.payment_request),
  });

  const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => {
    let isMounted = true;

    const pollTransactionStatuses = async () => {
      try {
        await getProfile(currentProfile);
      } catch (error) {
        // Error handling removed
      }

      await timeout(5000);

      try {
        if (newestEcashTx?.token) {
          const proofsSpent = await checkProofsSpent(newestEcashTx.token);
          if (proofsSpent) {
            const decodedToken = getDecodedToken(newestEcashTx.token);
            const amount = _.sumBy(decodedToken.proofs, 'amount');
            showMessage('funds_sent', { amount, unit: decodedToken.unit }, { emoji: '🎉' });
          }
        }
      } catch (error) {
        // Error handling removed
      }

      await timeout(5000);

      try {
        if (newestLightningTx) {
          await checkLNPaymentComplete({ transaction: newestLightningTx });
        }
      } catch (error) {
        // Error handling removed
      }

      if (isMounted) {
        setTimeout(pollTransactionStatuses, 10000);
      }
    };

    runWithAnimationFrame(pollTransactionStatuses)();

    return () => {
      isMounted = false;
    };
  }, [currentProfile.id, newestEcashTx?.token, newestLightningTx]);
};

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

  useTransactionStatusPolling();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {}, []);

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
