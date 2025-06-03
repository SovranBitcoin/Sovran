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
import WalletHeader from '../../../components/layout/WalletHeader';
import { useTypedNavigation } from 'helper/navigation';
import {
  appendTransaction,
  appendTransactionsV2,
  memoizedGetSelectedMint,
  memoizedGetTransactionByMatcher,
} from 'helper/redux/cashu';
import { isProduction } from 'helper/version';
import { MintQuoteResponse } from '@cashu/cashu-ts';
import _ from 'lodash';
import { useTransactions } from 'components/providers/TransactionsProvider';

async function getProfile(currentProfile, listenToTransaction) {
  const sk = nip19.decode(currentProfile?.nsec).data;
  const signer = new NsecSigner(sk);
  const sdk = new NCSDK('https://npubx.cash', signer);

  // TODO: get last transaction that is npubx.cash from fromNIP05
  const lastTransaction = memoizedGetTransactionByMatcher({
    profileId: currentProfile.id,
    matcher: (txs) => {
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

  // const info = await sdk.getInfo();
  // // {"data": {"user": {"lock_quote": false, "mintUrl": "https://mint.minibits.cash/Bitcoin", "pubkey": "c7d25e67daecaecfd2b7945c89d99cc037857c46bebe6d010c2543d0c7c03b4b"}}, "error": false}
  // // TODO: store this in settings

  // this +1 is kinda hacky, lets remove that and instead filter quotes based on transactions in redux
  const quotes = (await sdk.getQuotes({ since: new Date(lt?.date).getTime() / 1000 + 1 })).quotes;
  // // [
  // // {"amount": 5, "created_at": 1748060852, "expires_at": 1748147251, "locked": false, "mint_url": "https://mint.minibits.cash/Bitcoin", "paid_at": 1748060862, "quote_id": "bhYfrfGdWEuuRrsS8Ti4w9-nc6MnczFtvYlZFAzS", "request": "lnbc50n1p5rzj4npp544czew644u6cyedwvryhmlj8sg3zlmujygsu7x9uh60yrehszq3sdqqcqzzsxqyz5vqsp53wksgnt876825mcz6x7ktg6g5qp7ruvhk3rfzrtxntdxa6ajqfts9qxpqysgqzm7s7qhula8fqqq6d9a5pstylkd7m2hepp5uy49g0md8zlrymq44whetjkxcgkr904pvgr6q8aazkr48vq3ry0jlp8x9xtm88ayr6tsplw9573", "state": "PAID"},
  // // {"amount": 5, "created_at": 1748049508, "expires_at": 1748135908, "locked": false, "mint_url": "https://mint.minibits.cash/Bitcoin", "paid_at": 1748049519, "quote_id": "SgJ-euqTH0VZ1CuGWr7ibYS9-Qr8M6QiBXBZHpdX", "request": "lnbc50n1p5rz8nypp5xzymk2ghp4vv3d0qr3stl2dgh26hnfeywp96rk4l4c8x2x7erdmsdqqcqzzsxqyz5vqsp5qzm3j8rpl4mtcljuqsfhswh5hmz90q5fug82e0kg6uf6ru74s72q9qxpqysgq3wgtd8u9qvd2evg4hv5v65ftznpvak9jaj64tw54nqhaerv497k5z8lkf6djm2vuycgj366g07vyghcc7lenkygcynu94d67qfjnlcqp4h9gtx", "state": "PAID"}
  // // ]
  // // {"quotes": [{"amount": 5, "created_at": 1748049508, "expires_at": 1748135908, "locked": false, "mint_url": "https://mint.minibits.cash/Bitcoin", "paid_at": 1748049519, "quote_id": "SgJ-euqTH0VZ1CuGWr7ibYS9-Qr8M6QiBXBZHpdX", "request": "lnbc50n1p5rz8nypp5xzymk2ghp4vv3d0qr3stl2dgh26hnfeywp96rk4l4c8x2x7erdmsdqqcqzzsxqyz5vqsp5qzm3j8rpl4mtcljuqsfhswh5hmz90q5fug82e0kg6uf6ru74s72q9qxpqysgq3wgtd8u9qvd2evg4hv5v65ftznpvak9jaj64tw54nqhaerv497k5z8lkf6djm2vuycgj366g07vyghcc7lenkygcynu94d67qfjnlcqp4h9gtx", "state": "PAID"}]}
  // // TODO: append a new transaction with these details

  let transactions = [];
  for (const quote of quotes) {
    const mintQuote: MintQuoteResponse = {
      quote: quote.quote_id,
      request: quote.request,
      expiry: quote.expires_at,
      state: quote.state,
    };

    const transaction = {
      request: quote.request,
      amount: quote.amount,
      mintQuote,
      date: new Date(quote.paid_at * 1000),
      type: 'lightning',
      paid: false,
      transactionType: 'receive',
      unit: 'sat',
      mintUrl: quote.mint_url,
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

  // listenToTransaction(transactions);

  // const mintQuote: MintQuoteResponse = {
  //   quote: quotes[0].quote_id,
  //   request: quotes[0].request,
  //   expiry: quotes[0].expires_at,
  //   state: quotes[0].state,
  // };

  // const transaction = {
  //   request: quotes[0].request,
  //   amount: quotes[0].amount,
  //   mintQuote,
  //   date: new Date(quotes[0].paid_at * 1000),
  //   type: 'lightning',
  //   paid: false,
  //   transactionType: 'receive',
  //   unit: 'sat',
  //   mintUrl: quotes[0].mint_url,
  //   fromNIP05: `${currentProfile?.npub}@npubx.cash`,
  // };

  // store.dispatch(
  //   appendTransaction({
  //     profileId: currentProfile.id,
  //     transaction,
  //   })
  // );

  // const balance = await sdk.getBalance();

  // if (balance <= 0) {
  //   showMessage('no_funds');
  //   return;
  // }

  // const token = await sdk.getToken();

  // if (token) {
  //   await receiveEcash({
  //     token,
  //     unit: 'sat',
  //     fromNIP05: `${currentProfile?.npub}@npubx.cash`,
  //   });
  //   showMessage('funds_received', { amount: balance, unit: 'sat' }, { emoji: '🎉' }, () => {});
  // }
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
  const supportedUnits = isProduction ? ['sat', 'usd', 'eur', 'gbp'] : ['sat'];

  const [accounts, setAccounts] = useState([
    ...currencies.filter((u) => supportedUnits.includes(u.unit)),
  ]);
  const [account, setAccount] = useState(accounts[0]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await getProfile(currentProfile, listenToTransaction);
    setRefreshing(false);
  }, []);

  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const currentProfile = useSelector((state) => state.nostr.currentProfile);
  const settings = useSelector((state) => state.settings.settings);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const navigation = useTypedNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <WalletHeader unit={account.unit} accounts={accounts} setAccount={setAccount} />
      ),
    });
  }, [navigation, account, accounts]);

  const { listenToTransaction } = useTransactions();

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
