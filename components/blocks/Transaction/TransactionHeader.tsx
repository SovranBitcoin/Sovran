import React from 'react';
import { Text } from 'components/ui/Text';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { greens, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { formatCurrency, CurrencyCode, Denomination } from 'helper/currency';
import TransactionIcon from '../TransactionIcon';
import { TransactionData } from 'helper/redux/cashu';

interface TransactionHeaderProps {
  transaction: TransactionData;
}

export function TransactionHeader({ transaction }: TransactionHeaderProps) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <HStack
      align="center"
      justify="space-between"
      className="bg-transparent"
      style={{ paddingVertical: 16, paddingLeft: 8, paddingRight: 16 }}>
      <VStack className="bg-transparent">
        <HStack align="center" className="bg-transparent">
          <Spacer size={8} />
          <Text
            size={transaction.isSend ? 32 : 24}
            color={transaction.isSend ? reds[300] : greens[300]}>
            {transaction.isSend ? '-' : '+'}
          </Text>
          <Spacer size={8} />
          <AmountFormatter
            amount={transaction?.amount}
            unit={transaction?.unit}
            size={28}
            weight="heavy"
            color={transaction.isReceive ? greens[300] : reds[300]}
          />
        </HStack>
        <Text size={18} color={theme.greys[50]} bold style={{ marginLeft: 32 }}>
          {transaction?.amount < 0 ? '-' : ''}
          <Text size={18} color={theme.greys[50]} style={{ marginLeft: 8 }}>
            {transaction?.amount < 0 ? '-' : ''}
            {formatCurrency(
              {
                currency:
                  transaction?.unit === 'sat'
                    ? 'BTC'
                    : (transaction?.unit?.toUpperCase() as CurrencyCode),
                value: Math.abs(transaction?.amount),
                denomination:
                  transaction?.unit === 'sat' ? 'sats' : (transaction?.unit as Denomination),
              },
              {
                locale: 'en-US',
                precision: 2,
                currencyDisplay: transaction?.unit === 'usd' ? 'name' : 'symbol',
                denomination: transaction?.unit === 'usd' ? 'sats' : 'usd',
              }
            )}
          </Text>
        </Text>
      </VStack>
      <View className="scale-125 transform bg-transparent p-4">
        <TransactionIcon transaction={transaction} />
      </View>
    </HStack>
  );
}
