import React from 'react';
import { Text, View } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { greens, greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { formatCurrency } from 'helper/currency';
import TransactionIcon, { TransactionData } from './TransactionIcon';

interface BalanceUpdateProps {
  transactionType: 'send' | 'receive' | string;
  amount: number;
  unit: string;
  pubkey?: string;
  request?: string;
  transaction?: { isCancel?: boolean };
  bottomAmount?: string;
  cancelled?: boolean;
}

export function BalanceUpdate({
  transactionType,
  amount,
  unit,
  pubkey,
  request,
  transaction,
  bottomAmount,
  cancelled,
}: BalanceUpdateProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);

  const isSend = transactionType === 'send';
  const isReceive = transactionType === 'receive';

  const Sign = () => {
    if (isSend)
      return (
        <Text
          size={32}
          weight="bold"
          className="ml-2"
          style={{ color: shades[300], marginRight: 8 }}>
          -
        </Text>
      );
    if (isReceive)
      return (
        <Text
          weight="bold"
          size={24}
          className="ml-2"
          style={{
            color: greens[300],
            textShadowColor: opacity(greys(theme)[0], 0.5),
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: 1,
            marginRight: 8,
          }}>
          +
        </Text>
      );
    return null;
  };
  const txData: TransactionData = {
    transactionType,
    amount,
    unit,
    request,
    isCancel: cancelled || transaction?.isCancel,
    ...(pubkey ? { nostr: { pubkey } } : {}),
    ...((transaction as any)?.fromNIP05 ? { fromNIP05: (transaction as any).fromNIP05 } : {}),
  };

  return (
    <View className="flex-row items-center justify-between bg-transparent py-4 pl-2 pr-4">
      <View className="bg-transparent">
        <View className="flex-row items-center bg-transparent">
          <Sign />
          <AmountFormatter
            amount={amount}
            unit={unit}
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
          {amount < 0 ? '-' : ''}
          <Text
            size={20}
            style={{
              color: greys(theme)[100],
              fontFamily: 'OverpassBold',
              marginLeft: 18,
              backgroundColor: 'transparent',
            }}>
            {amount < 0 ? '-' : ''}
            {bottomAmount
              ? bottomAmount
              : formatCurrency(
                  {
                    currency: unit === 'sat' ? 'BTC' : unit?.toUpperCase(),
                    value: Math.abs(amount),
                    denomination: unit === 'sat' ? 'sats' : unit,
                  },
                  {
                    locale: 'en-US',
                    precision: 2,
                    currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
                    denomination: unit === 'usd' ? 'sats' : 'usd',
                  }
                )}
          </Text>
        </Text>
      </View>
      <View className="bg-transparent p-4" style={{ transform: [{ scale: 1.25 }] }}>
        <TransactionIcon transaction={txData} />
      </View>
    </View>
  );
}
