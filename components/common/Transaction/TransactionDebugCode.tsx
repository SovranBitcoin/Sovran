import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import React from 'react';
import { ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { Text } from 'components/common/Text';
import { TransactionData } from 'helper/redux/cashu';

interface TransactionDebugCodeProps {
  transaction: TransactionData;
}

export function TransactionDebugCode({ transaction }: TransactionDebugCodeProps) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ScrollView
      horizontal
      style={{
        padding: 16,
        margin: 16,
        borderRadius: 8,
        backgroundColor: greys(theme)[1800],
      }}>
      <Text mono>{transaction.toString()}</Text>
    </ScrollView>
  );
}
