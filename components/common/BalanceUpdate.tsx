import React, { JSX } from 'react';
import { Text, View } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { greens, greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { formatCurrency } from 'helper/currency';
import TransactionIcon from './TransactionIcon';

export function BalanceUpdate({ transaction }: any): JSX.Element {
  const theme = useSelector(memoizedGetTheme);

  return (
    <View className="flex-row items-center justify-between bg-transparent py-4 pl-2 pr-4">
      <View className="bg-transparent">
        <View className="flex-row items-center bg-transparent">
          <Text
            size={transaction.isSend ? 32 : 24}
            color={transaction.isSend ? shades[300] : greens[300]}
            className="ml-2 mr-2">
            {transaction.isSend ? '-' : '+'}
          </Text>
          <AmountFormatter
            amount={transaction?.amount}
            unit={transaction?.unit}
            size={28}
            weight="heavy"
            color={transaction.isReceive ? greens[300] : shades[300]}
          />
        </View>
        <Text size={18} color={greys(theme)[100]} bold className="ml-8">
          {transaction?.amount < 0 ? '-' : ''}
          <Text
            size={18}
            color={greys(theme)[100]}
            style={{
              marginLeft: 18,
            }}>
            {transaction?.amount < 0 ? '-' : ''}
            {formatCurrency(
              {
                currency: transaction?.unit === 'sat' ? 'BTC' : transaction?.unit?.toUpperCase(),
                value: Math.abs(transaction?.amount),
                denomination: transaction?.unit === 'sat' ? 'sats' : transaction?.unit,
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
      </View>
      <View className="bg-transparent p-4" style={{ transform: [{ scale: 1.25 }] }}>
        <TransactionIcon transaction={transaction} />
      </View>
    </View>
  );
}
