import React from 'react';
import { ColorValue } from 'react-native';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { formatAmount } from 'helper/currency';
import { convertTime } from 'helper/time';
import { useTheme } from 'providers/ThemeProvider';
import { TransactionData } from 'helper/redux/cashu';

const TransactionComponent = ({
  transaction,
  isReceived,
}: {
  transaction: TransactionData;
  isReceived: boolean;
}) => {
  const { getPrimaryColor, currentTheme, getShadeColor, getRedColor, getGreenColor } = useTheme();
  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [getPrimaryColor('500'), getPrimaryColor('500')]
    : [getShadeColor('200'), getShadeColor('300')];

  const arrowBackgroundColor = isReceived ? getPrimaryColor('500') : getShadeColor('300');

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
      style={{ minHeight: 80 }} // Ensure minimum height for payment messages
    >
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
          minHeight: 70, // Ensure minimum height for content
        }}>
        <View className="mb-1 rounded-2xl bg-black/25 p-1">
          <Text className="text-primary-0 text-center text-sm font-bold">
            {isReceived ? 'You received' : 'You sent'}
          </Text>
        </View>
        <Text className="text-primary-0 mb-2 text-base font-black">{formattedAmount}</Text>
        <Text className="text-primary-0 text-right text-xs font-bold opacity-75">
          {transaction?.date ? convertTime(new Date(transaction.date)) : null}
        </Text>
      </LinearGradient>
    </View>
  );
};

export default TransactionComponent;
