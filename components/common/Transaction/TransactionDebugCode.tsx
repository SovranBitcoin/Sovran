import { memoizedGetTheme } from 'helper/redux/settings';
import React from 'react';
import { ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { Text } from 'components/common/Text';
import { TransactionData } from 'helper/redux/cashu';
import { View } from 'components/common/View';

interface TransactionDebugCodeProps {
  transaction: TransactionData;
}

export function TransactionDebugCode({ transaction }: TransactionDebugCodeProps) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ScrollView horizontal>
      <View
        blur
        style={{
          padding: 16,
          marginHorizontal: 16,
          borderRadius: 8,
          backgroundColor: theme.greys[800],
        }}>
        <Text mono>{transaction.toString()}</Text>
      </View>
    </ScrollView>
  );
}
