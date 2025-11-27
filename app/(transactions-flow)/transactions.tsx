/**
 * @fileoverview Transactions flow entry screen
 *
 * Part of the (transactions-flow) modal group.
 * Clicking on a transaction navigates horizontally within the modal.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionsScreen } from 'components/screens/TransactionsScreen';
import { HistoryEntry, ReceiveHistoryEntry } from 'coco-cashu-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';

function ModalScreen() {
  const { account, tab: tab_ } = useLocalSearchParams<{
    account: string;
    tab: 'All' | 'Incoming' | 'Outgoing';
  }>();
  const insets = useSafeAreaInsets();
  const { getPrimaryColor } = useTheme();

  const initialAccount = account ? JSON.parse(account) : undefined;
  const initialTab = (tab_ as 'All' | 'Confirmed' | 'Pending' | 'Expired') || 'All';

  // Handle transaction press - navigate within the transactions flow
  // Using router.navigate to prevent duplicate navigation on rapid presses
  const handleTransactionPress = (historyEntry: HistoryEntry) => {
    switch (historyEntry.type) {
      case 'mint': {
        router.navigate({
          pathname: '/(transactions-flow)/mintQuote',
          params: {
            mintHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'melt': {
        router.navigate({
          pathname: '/(transactions-flow)/meltQuote',
          params: {
            meltHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'send': {
        router.navigate({
          pathname: '/(transactions-flow)/sendToken',
          params: {
            sendHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'receive': {
        const receiveEntry = historyEntry as ReceiveHistoryEntry & { token?: string };
        router.navigate({
          pathname: '/(transactions-flow)/receiveToken',
          params: {
            receiveHistoryEntry: JSON.stringify(receiveEntry),
          },
        });
        return;
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950'), paddingTop: insets.top + 48 }}>
      <Stack.Screen options={{ title: 'Transactions' }} />
      <TransactionsScreen
        initialAccount={initialAccount}
        initialTab={initialTab}
        onTransactionPress={handleTransactionPress}
      />
    </View>
  );
}

export default withSheetProvider(ModalScreen);

