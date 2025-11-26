/**
 * @fileoverview Standalone transactions route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * For flow-based navigation with horizontal stack, use (transactions-flow)/transactions.
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionsScreen } from 'components/screens/TransactionsScreen';
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

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950'), paddingTop: insets.top + 48 }}>
      <TransactionsScreen initialAccount={initialAccount} initialTab={initialTab} />
    </View>
  );
}

export default withSheetProvider(ModalScreen);
