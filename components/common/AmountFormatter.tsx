import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { StyledText, Text } from 'components/common/Text';
import { View } from 'components/common/View';
import { formatCurrencyWrapper } from 'helper/currency';
import { BtcIcon, LightningUnit } from 'assets/icons';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type FontWeight = 'heavy' | 'medium' | 'regular' | 'light';

interface AmountFormatterProps {
  amount: number;
  unit: CurrencyUnit;
  size?: number;
  weight?: FontWeight;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Formats and displays monetary amounts with appropriate currency symbols
 */
export function AmountFormatter({
  amount,
  unit,
  size = 37,
  weight = 'heavy',
  color,
  style,
}: AmountFormatterProps) {
  const theme = useSelector(memoizedGetTheme);
  const { settings } = useSettings();
  const currentColor = color || greys(theme)[0];
  const displayBtc = settings.display_btc ?? 1;

  if (unit !== 'sat') {
    return (
      <View className="flex-row items-center" style={[{ backgroundColor: 'transparent' }, style]}>
        <Text
          size={size}
          weight={weight}
          style={{
            color: currentColor,
            margin: 0,
            zIndex: 2,
          }}>
          {formatCurrencyWrapper(amount, unit, displayBtc)}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-row items-center" style={[{ backgroundColor: 'transparent' }, style]}>
      {displayBtc === 0 && (
        <View className="flex-row items-center" style={[{ backgroundColor: 'transparent' }, style]}>
          <View
            style={{ marginLeft: weight === 'heavy' ? -6 : -4, backgroundColor: 'transparent' }}>
            <BtcIcon weight={weight} height={size} width={size} color={currentColor} />
          </View>
          <Text
            size={size}
            weight={weight}
            style={{
              color: currentColor,
              marginLeft: weight === 'heavy' ? -2 : -4,
              margin: 0,
              zIndex: 2,
            }}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </Text>
        </View>
      )}

      {displayBtc === 1 && (
        <View className="flex-row items-center" style={[{ backgroundColor: 'transparent' }, style]}>
          <StyledText
            size={size}
            weight={weight}
            style={{
              color: currentColor,
              margin: 0,
              zIndex: 2,
            }}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </StyledText>
          <View style={{ marginBottom: 4, backgroundColor: 'transparent' }}>
            <LightningUnit height={size} width={size} color={currentColor} />
          </View>
        </View>
      )}

      {displayBtc === 2 && (
        <View className="flex-row items-center" style={[{ backgroundColor: 'transparent' }, style]}>
          <Text
            size={size}
            weight={weight}
            style={{
              color: currentColor,
              margin: 0,
              zIndex: 2,
            }}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </Text>
        </View>
      )}

      {displayBtc === 3 && (
        <View className="flex-row items-center" style={[{ backgroundColor: 'transparent' }, style]}>
          <View
            style={{ marginLeft: weight === 'heavy' ? -6 : -4, backgroundColor: 'transparent' }}>
            <BtcIcon weight={weight} height={size} width={size} color={currentColor} />
          </View>
          <Text
            size={size}
            weight={weight}
            style={{
              color: currentColor,
              marginLeft: weight === 'heavy' ? -2 : -4,
              margin: 0,
              zIndex: 2,
            }}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </Text>
        </View>
      )}
    </View>
  );
}
