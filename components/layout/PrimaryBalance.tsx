import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { View, Text } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { useSettings } from 'helper/redux/settings';
import { memoizedGetTotalBalance } from 'helper/redux/cashu';
import Haptics from 'components/common/Haptics';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { memoizedPricelist } from 'helper/redux/pricelist';
import { greens } from 'helper/colors';
import opacity from 'hex-color-opacity';
// Define proper interfaces
interface Account {
  unit: CurrencyUnit;
}

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type DisplayBtcMode = 0 | 1 | 2 | 3;

interface PrimaryBalanceProps {
  account: Account;
}

/**
 * Component that displays the primary balance with unit toggling capability
 */
export function PrimaryBalance({ account }: PrimaryBalanceProps): React.ReactElement {
  const { settings, setDisplayBitcoin } = useSettings();
  const balance = useSelector(memoizedGetTotalBalance(account.unit));
  const btcPrice = useSelector(memoizedPricelist);

  const toggleUnit = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDisplayBitcoin(((settings.display_btc + 1) % 4) as DisplayBtcMode);
  }, [settings.display_btc, setDisplayBitcoin]);

  return (
    <View
      className="z-9 flex-row items-center justify-center pt-0"
      style={{ backgroundColor: 'transparent', flexDirection: 'column' }}>
      {btcPrice?.usd?.btc && (
        <View
          style={{
            backgroundColor: opacity(greens[400], 0.1),
            padding: 8,
            borderRadius: 100,
            marginTop: -16,
          }}>
          <Text
            bold
            size={12}
            style={{
              color: greens[400],
            }}>
            ≈ ${((btcPrice?.usd?.btc / 100_000_000) * balance).toFixed(2)}
          </Text>
        </View>
      )}
      <TouchableOpacity onPress={toggleUnit} className="flex-col items-center">
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
      </TouchableOpacity>
    </View>
  );
}
