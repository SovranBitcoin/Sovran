import 'app/global';
import React, {
  memo,
  useCallback,
  useState,
  useLayoutEffect,
  useEffect,
} from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { nip19 } from 'nostr-tools';
import { Spacer, View } from 'components/common/View';
import { Transactions } from 'components/layout/Transactions';
import {
  useCashu,
  appendTransactionsV2,
  memoizedGetSelectedMint,
  memoizedGetAllBalancesMultipleCurrencies,
  memoizedGetTransactionByMatcher,
  TransactionData,
} from 'helper/redux/cashu';
import { useTransactionsData } from 'helper/hooks/useTransactionsData';
import { NCSDK } from 'helper/third-party/cashu-address-sdk-rn/sdk';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import {
  memoizedGetBackgroundImage,
  memoizedGetSettings,
  memoizedGetTheme,
} from 'helper/redux/settings';
import { store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import Welcome from 'app/onboard/welcome';
import TermsConditionsScreen from 'app/settings/terms';
import WalletHeader from '../../../components/layout/WalletHeader';
import { useTypedNavigation } from 'helper/navigation';
import { MintQuoteResponse, MintQuoteState } from '@cashu/cashu-ts';
import _ from 'lodash';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import AnimatedSpriteBackground from 'components/common/SpriteView';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { AccountPagerView } from 'components/layout/AccountPagerView';
import { Card } from 'components/common/Card';
interface NPUBQuote {
  amount: number;
  createdAt: number;
  expiresAt: number;
  locked: boolean;
  mintUrl: string;
  paidAt: number;
  quoteId: string;
  request: string;
  state: MintQuoteState;
}

export async function getProfile(currentProfile: any, listenToTransaction: any) {
  const sk = nip19.decode(currentProfile?.nsec).data;
  const signer = new NsecSigner(sk as Uint8Array);
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
  const quotes: NPUBQuote[] = (
    await sdk.getQuotes({ since: new Date(lt?.date).getTime() / 1000 + 1 })
  ).quotes;

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

    const transaction: TransactionData = {
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

function TabOneScreen() {
  const supportedUnits = ['sat', 'usd', 'eur', 'gbp'];

  const accounts = [
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
  ].filter((u) => supportedUnits.includes(u.unit));

  const [account, setAccount] = useState(accounts[0]);

  const onRefresh = useCallback(async () => {}, []);

  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const { transactions } = useCashu();
  const txData = useTransactionsData({
    transactions,
    account,
    days: 1,
    showMore: true,
  });

  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const settings = useSelector(memoizedGetSettings);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const balances = useSelector(memoizedGetAllBalancesMultipleCurrencies);
  const navigation = useTypedNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <WalletHeader unit={account.unit} accounts={accounts} setAccount={setAccount} />
      ),
    });
  }, [navigation, account, accounts]);

  const image = useSelector(memoizedGetBackgroundImage);

  const availableUnits = React.useMemo(
    () =>
      balances
        .filter((b) => b.mintUrl === selectedMint)
        .map((b) => b.unit.toLowerCase()),
    [balances, selectedMint]
  );

  useEffect(() => {
    if (!availableUnits.includes(account.unit)) {
      const first = availableUnits[0];
      const found = accounts.find((a) => a.unit === first);
      if (found) {
        setAccount(found);
      }
    }
  }, [availableUnits]);

  useFocusEffect(
    useCallback(() => {
      if (!availableUnits.includes(account.unit)) {
        const first = availableUnits[0];
        const found = accounts.find((a) => a.unit === first);
        if (found) {
          setAccount(found);
        }
      }
    }, [availableUnits, account.unit])
  );

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

  console.log(23982737, theme.greys);

  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
      }}>
      <AnimatedSpriteBackground backgroundColor={theme.greys[950]} />

      <View style={styles.safeAreaView}>
        <ScrollView
          style={styles.scrollView}
          refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
          <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
          <View className="mx-4">
            <Spacer size={12} />
            <Card
              message="Do not use with large amounts of ecash. Sovran is still in development and is operated on a best-effort basis and without any guarentees."
              variant="warning"
            />
          </View>
          <View
            className="p-4"
            style={{
              backgroundColor: opacity(theme.greys[950], 0.99),
            }}>
            {theme.shades && (
              <LinearGradient
                colors={[
                  opacity(theme.greys[950], 0.99),
                  opacity(theme.greys[950], 0.5),
                  opacity(theme.greys[950], 0),
                ]}
                start={{ x: 0.5, y: 1 }}
                end={{ x: 0.5, y: 0 }}
                style={[StyleSheet.absoluteFill, { zIndex: -1, top: -250, height: 250 }]}
              />
            )}
            <Transactions
              account={account}
              showMore={true}
              pendingSections={txData.pendingSections}
              confirmedSections={txData.confirmedSections}
              allSections={txData.allSections}
              filteredCount={txData.filteredTransactions.length}
              morePendingCount={txData.morePendingCount}
            />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    scrollView: {
      marginTop: 0,
    },
    safeAreaView: {
      flex: 1,
    },
    accountPagerView: {
      display: 'flex',
      // height: 550,
      width: '100%',
    },
  });

export default memo(TabOneScreen);
