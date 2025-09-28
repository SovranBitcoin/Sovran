import React from 'react';
import { ColorValue } from 'react-native';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { CurrencyCode, Denomination, formatCurrency } from 'helper/currency';
import { convertTime } from 'helper/time';
import { greys, Theme } from 'helper/colors';
import { TransactionData } from 'helper/redux/cashu';

const TransactionComponent = ({
  transaction,
  theme,
  isReceived,
}: {
  transaction: TransactionData;
  theme: Theme;
  isReceived: boolean;
}) => {
  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [greys(theme)[500], greys(theme)[500]]
    : [theme.shades[200], theme.shades[300]];

  const arrowBackgroundColor = isReceived ? greys(theme)[500] : theme.shades[300];

  const formattedAmount =
    transaction.unit &&
    formatCurrency(
      {
        currency:
          transaction.unit === 'sat' ? 'BTC' : (transaction.unit.toUpperCase() as CurrencyCode),
        value: transaction.amount,
        denomination: transaction.unit === 'sat' ? 'sats' : (transaction.unit as Denomination),
      },
      {
        locale: 'en-US',
        precision: transaction.unit === 'sat' ? 0 : 2,
        currencyDisplay: transaction.unit === 'sat' ? 'name' : 'symbol',
        denomination: transaction.unit === 'sat' ? 'sats' : (transaction.unit as Denomination),
      }
    );

  return (
    <View className={`relative my-2 ${isReceived ? 'self-start' : 'self-end'}`}>
      <View
        className="absolute -bottom-1 h-2 w-2"
        style={{
          backgroundColor: arrowBackgroundColor,
          left: isReceived ? 16 : 'auto',
          right: isReceived ? 'auto' : 16,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <LinearGradient
        colors={gradientColors}
        style={{
          borderRadius: 16,
          padding: 16,
          maxWidth: '75%',
        }}>
        <View className="mb-1 rounded-2xl bg-black/25 p-1">
          <Text className="text-center text-sm font-bold" style={{ color: greys(theme)[0] }}>
            {isReceived ? 'You received' : 'You sent'}
          </Text>
        </View>
        <Text className="mb-2 text-base font-black" style={{ color: greys(theme)[0] }}>
          {formattedAmount}
        </Text>
        <Text
          className="text-right text-xs font-bold opacity-75"
          style={{ color: greys(theme)[0] }}>
          {transaction?.date ? convertTime(new Date(transaction.date)) : null}
        </Text>
      </LinearGradient>
    </View>
  );
};

export default TransactionComponent;
