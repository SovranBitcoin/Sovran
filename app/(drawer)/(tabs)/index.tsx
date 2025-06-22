import 'app/global';
import React, { memo, useCallback, useState, useLayoutEffect } from 'react';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { nip19 } from 'nostr-tools';
import { ImageBackground } from 'expo-image';
import { View } from 'components/common/Themed';
import { Transactions } from 'components/layout/Transactions';
import { NCSDK } from 'helper/third-party/cashu-address-sdk-rn/sdk';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import { greys } from 'helper/colors';
import { memoizedGetSettings, memoizedGetTheme } from 'helper/redux/settings';
import { store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import Welcome from 'app/onboard/welcome';
import TermsConditionsScreen from 'app/settings/terms';
import { AccountPagerView } from '../../../components/layout/AccountPagerView';
import WalletHeader from '../../../components/layout/WalletHeader';
import { useTypedNavigation } from 'helper/navigation';
import {
  appendTransactionsV2,
  memoizedGetSelectedMint,
  memoizedGetTransactionByMatcher,
  TransactionData,
} from 'helper/redux/cashu';
import { isProduction } from 'helper/version';
import { MintQuoteResponse } from '@cashu/cashu-ts';
import _ from 'lodash';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { Card } from 'components/common/Card';

export async function getProfile(currentProfile: any, listenToTransaction: any) {
  const sk = nip19.decode(currentProfile?.nsec).data;
  const signer = new NsecSigner(sk);
  const sdk = new NCSDK('https://npubx.cash', signer);

  // TODO: get last transaction that is npubx.cash from fromNIP05
  const lastTransaction = memoizedGetTransactionByMatcher({
    profileId: currentProfile.id,
    matcher: (txs: TransactionData[]) => {
      const transactions = _.filter(txs, {
        fromNIP05: `${currentProfile?.npub}@npubx.cash`,
        type: 'lightning',
        transactionType: 'receive',
        unit: 'sat',
      });

      return _.sortBy(transactions, (tx) => new Date(tx.date));
    },
  })(store.getState());

  const lt = lastTransaction?.[lastTransaction?.length - 1];

  // this +1 is kinda hacky, lets remove that and instead filter quotes based on transactions in redux
  const quotes = (await sdk.getQuotes({ since: new Date(lt?.date).getTime() / 1000 + 1 })).quotes;

  if (quotes.length === 0) {
    showMessage('no_funds');
    return;
  }

  let transactions = [];
  for (const quote of quotes) {
    const mintQuote: MintQuoteResponse = {
      quote: quote.quoteId,
      request: quote.request,
      expiry: quote.expiresAt,
      state: quote.state,
    };

    const transaction = {
      request: quote.request,
      amount: quote.amount,
      mintQuote,
      date: new Date(quote.paidAt * 1000),
      type: 'lightning',
      paid: false,
      transactionType: 'receive',
      unit: 'sat',
      mintUrl: quote.mintUrl,
      fromNIP05: `${currentProfile?.npub}@npubx.cash`,
    };

    store.dispatch(
      appendTransactionsV2({
        profileId: currentProfile.id,
        transactions: [transaction],
      })
    );
    transactions.push(transaction);
  }

  listenToTransaction(transactions);
}

function TabOneScreen({
  currencies = [
    {
      unit: 'sat',
    },
    {
      unit: 'usd',
    },
    {
      unit: 'eur',
    },
    {
      unit: 'gbp',
    },
  ],
}) {
  const supportedUnits = isProduction ? ['sat'] : ['sat'];

  const [accounts, setAccounts] = useState([
    ...currencies.filter((u) => supportedUnits.includes(u.unit)),
  ]);
  const [account, setAccount] = useState(accounts[0]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {}, []);

  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const settings = useSelector(memoizedGetSettings);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const navigation = useTypedNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <WalletHeader unit={account.unit} accounts={accounts} setAccount={setAccount} />
      ),
    });
  }, [navigation, account, accounts]);

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

  if (!(currentProfile?.pubkey && selectedMint)) {
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
          {new Date().getTime() > new Date('2025-06-18').getTime() && (
            <View
              style={{
                margin: 16,
                marginTop: -40,
                marginBottom: 32,
              }}>
              <Card
                message="Do not use with large amounts of ecash. Sovran is still in development and is operated on a best-effort basis and without any guarentees."
                variant="info"
              />
            </View>
          )}
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
      marginTop: 0,
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
