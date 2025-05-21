import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { StyledText, Text, View } from 'components/common/Themed';
import { formatCurrencyWrapper } from 'helper/currency';
import { BtcIcon, LightningUnit } from 'assets/icons';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import { memoizedGetTotalBalance } from 'helper/redux/cashu';
import Haptics from 'components/common/Haptics';

// Define proper interfaces
interface Account {
  unit: CurrencyUnit;
}

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type DisplayBtcMode = 0 | 1 | 2 | 3;
type FontWeight = 'heavy' | 'medium' | 'regular' | 'light';

interface PrimaryBalanceProps {
  account: Account;
}

interface AmountFormatterProps {
  amount: number;
  unit: CurrencyUnit;
  size?: number;
  weight?: FontWeight;
  color?: string;
}

/**
 * Component that displays the primary balance with unit toggling capability
 */
export function PrimaryBalance({ account }: PrimaryBalanceProps): React.ReactElement {
  const { settings, setDisplayBitcoin } = useSettings();
  const balance = useSelector(memoizedGetTotalBalance(account.unit));

  const toggleUnit = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDisplayBitcoin(((settings.display_btc + 1) % 4) as DisplayBtcMode);
  }, [settings.display_btc, setDisplayBitcoin]);

  return (
    <View
      className="z-9 flex-row items-center justify-center pt-0"
      style={{ backgroundColor: 'transparent' }}>
      <TouchableOpacity onPress={toggleUnit} className="flex-col items-center">
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
      </TouchableOpacity>
    </View>
  );
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
}: AmountFormatterProps): React.ReactElement {
  const theme = useSelector(memoizedGetTheme);
  const { settings } = useSettings();
  const currentColor = color || greys(theme)[0];
  const displayBtc = settings.display_btc ?? 1;

  if (unit !== 'sat') {
    return (
      <View className="flex-row items-center" style={{ backgroundColor: 'transparent' }}>
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
    <View className="flex-row items-center" style={{ backgroundColor: 'transparent' }}>
      {displayBtc === 0 && (
        <>
          <View
            style={{ marginLeft: weight === 'heavy' ? -7 : -4, backgroundColor: 'transparent' }}>
            <BtcIcon weight={weight} height={size} width={size * 1.4} color={currentColor} />
          </View>
          <Text
            size={size}
            weight={weight}
            style={{
              color: currentColor,
              marginLeft: weight === 'heavy' ? -7 : -4,
              margin: 0,
              zIndex: 2,
            }}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </Text>
        </>
      )}

      {displayBtc === 1 && (
        <>
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
        </>
      )}

      {displayBtc === 2 && (
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
      )}

      {displayBtc === 3 && (
        <>
          <View
            style={{ marginLeft: weight === 'heavy' ? -7 : -4, backgroundColor: 'transparent' }}>
            <BtcIcon weight={weight} height={size} width={size * 1.4} color={currentColor} />
          </View>
          <Text
            size={size}
            weight={weight}
            style={{
              color: currentColor,
              marginLeft: weight === 'heavy' ? -7 : -4,
              margin: 0,
              zIndex: 2,
            }}>
            {formatCurrencyWrapper(amount, unit, displayBtc)}
          </Text>
        </>
      )}
    </View>
  );
}
