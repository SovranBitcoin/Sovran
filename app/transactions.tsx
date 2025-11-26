/**
 * @fileoverview Standalone transactions route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * For flow-based navigation with horizontal stack, use (transactions-flow)/transactions.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionsScreen } from 'components/screens/TransactionsScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';

function ModalScreen() {
  const { account, tab: tab_ } = useLocalSearchParams<{
    account: string;
    tab: 'All' | 'Incoming' | 'Outgoing';
  }>();
  const insets = useSafeAreaInsets();
  const { getPrimaryColor } = useTheme();

  const initialAccount = account ? JSON.parse(account) : undefined;
  const initialTab = (tab_ as 'All' | 'Confirmed' | 'Pending' | 'Expired') || 'All';

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950'), paddingTop: insets.top + 48 }}>
      <Stack.Screen
        options={{
          title: 'Transactions',
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: () => <CloseButton />,
        }}
      />
      <TransactionsScreen initialAccount={initialAccount} initialTab={initialTab} />
    </View>
  );
}

export default withSheetProvider(ModalScreen);
