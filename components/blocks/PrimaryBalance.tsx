import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { View, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { useSettings } from 'helper/redux/settings';
import { memoizedGetTotalBalance } from 'helper/redux/cashu';
import Haptics from 'components/ui/Haptics';
import { AmountFormatter } from 'components/ui/AmountFormatter';
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
    <VStack align="center" className="z-9">
      {btcPrice?.usd?.btc && (
        <View
          blur
          colorBlur={opacity(greens[300], 0.2)}
          style={{
            borderColor: opacity(greens[300], 0.5),
            backgroundColor: opacity(greens[300], 0.1),
            borderWidth: 0.2,
            padding: 8,
            borderRadius: 100,
            marginTop: -16,
          }}>
          <Text
            bold
            size={12}
            style={{
              color: greens[200],
            }}>
            ≈ ${((btcPrice?.usd?.btc / 100_000_000) * balance).toFixed(2)}
          </Text>
        </View>
      )}
      <TouchableOpacity onPress={toggleUnit} className="flex-col items-center">
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
      </TouchableOpacity>
    </VStack>
  );
}
