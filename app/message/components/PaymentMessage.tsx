import React from 'react';
import { ColorValue } from 'react-native';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { formatAmount } from 'helper/currency';
import { convertTime } from 'helper/time';
import { useThemeColor } from '@/hooks/useThemeColor';
import { TransactionData } from 'redux/cashu';

const TransactionComponent = ({
  transaction,
  isReceived,
}: {
  transaction: TransactionData;
  isReceived: boolean;
}) => {
  const [accent, danger] = useThemeColor(['accent', 'danger'] as const);
  const brandGradient = useThemeColor(['shade-200', 'shade-300', 'shade-400'] as const);
  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [accent, accent]
    : [brandGradient[0], brandGradient[1]];

  const arrowBackgroundColor = isReceived ? accent : danger;

  const formattedAmount =
    transaction.unit &&
    formatAmount(
      { amount: transaction.amount, unit: transaction.unit },
      {
        currencyDisplay: transaction.unit === 'sat' ? 'name' : 'symbol',
      }
    );

  return (
    <View
      className={`relative my-2 ${isReceived ? 'self-start' : 'self-end'}`}
      style={{ minHeight: 80 }}>
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
          minHeight: 70,
        }}>
        <View className="mb-1 rounded-2xl bg-black/25 p-1">
          <Text className="text-foreground text-center text-sm font-bold">
            {isReceived ? 'You received' : 'You sent'}
          </Text>
        </View>
        <Text className="text-foreground mb-2 text-base font-black">{formattedAmount}</Text>
        <Text className="text-foreground text-right text-xs font-bold opacity-75">
          {transaction?.date ? convertTime(new Date(transaction.date)) : null}
        </Text>
      </LinearGradient>
    </View>
  );
};

export default TransactionComponent;
