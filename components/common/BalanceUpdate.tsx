import React from 'react';
import { Text, View } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { greens, greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { formatCurrency } from 'helper/currency';
import TransactionIcon from './TransactionIcon';

interface BalanceUpdateProps {
  transaction?: { isCancel?: boolean };
  bottomAmount?: string;
}

export function BalanceUpdate({ transaction, bottomAmount }: BalanceUpdateProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);

  const isSend = transaction?.transactionType === 'send';
  const isReceive = transaction?.transactionType === 'receive';

  return (
    <View className="flex-row items-center justify-between bg-transparent py-4 pl-2 pr-4">
      <View className="bg-transparent">
        <View className="flex-row items-center bg-transparent">
          <Text
            size={isSend ? 32 : 24}
            className="ml-2"
            style={{
              color: isSend ? shades[300] : greens[300],
              marginRight: 8,
            }}>
            {isSend ? '-' : '+'}
          </Text>
          <AmountFormatter
            amount={transaction?.amount}
            unit={transaction?.unit}
            size={28}
            weight="heavy"
            color={isReceive ? greens[300] : shades[300]}
          />
        </View>
        <Text
          size={18}
          style={{
            color: greys(theme)[100],
            marginLeft: 30,
            fontFamily: 'OverpassBold',
            backgroundColor: 'transparent',
          }}>
          {transaction?.amount < 0 ? '-' : ''}
          <Text
            size={20}
            style={{
              color: greys(theme)[100],
              fontFamily: 'OverpassBold',
              marginLeft: 18,
              backgroundColor: 'transparent',
            }}>
            {transaction?.amount < 0 ? '-' : ''}
            {bottomAmount
              ? bottomAmount
              : formatCurrency(
                  {
                    currency:
                      transaction?.unit === 'sat' ? 'BTC' : transaction?.unit?.toUpperCase(),
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
