import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import { VStack, HStack } from 'components/ui/View';
import { useSettingsStore, DisplayCurrency } from 'stores/settingsStore';
import { useBalanceContext, useMints } from 'hooks/coco';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { useBtcPrice } from 'stores/pricelistStore';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { ContextMenu, Host, Button as SwiftUIButton, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';

interface Account {
  unit: CurrencyUnit;
}

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type DisplayBtcMode = 0 | 1 | 2 | 3;

interface PrimaryBalanceProps {
  account: Account;
}

// Currency display configuration
const CURRENCY_CONFIG: Record<DisplayCurrency, { symbol: string; label: string }> = {
  usd: { symbol: '$', label: 'USD' },
  eur: { symbol: '€', label: 'EUR' },
  gbp: { symbol: '£', label: 'GBP' },
};

/**
 * Component that displays the primary balance with unit toggling capability
 */
export function PrimaryBalance({ account }: PrimaryBalanceProps): React.ReactElement {
  const displayBtc = useSettingsStore((state) => state.getDisplayBtc());
  const setDisplayBtc = useSettingsStore((state) => state.setDisplayBtc);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const setDisplayCurrency = useSettingsStore((state) => state.setDisplayCurrency);
  const { balance: liveBalances } = useBalanceContext();
  const { mints } = useMints();
  const btcPrice = useBtcPrice(displayCurrency);
  const { getGreenColor } = useTheme();

  // Calculate total balance for this unit across all mints
  const balance = React.useMemo(() => {
    let totalBalance = 0;

    // Sum up balances from all mints for this unit
    mints.forEach((mint) => {
      const mintBalance = liveBalances[mint.mintUrl] || 0;
      // For now, assume all balances are in the same unit (sats)
      // In the future, this might need unit conversion logic
      totalBalance += mintBalance;
    });

    return totalBalance;
  }, [liveBalances, mints]);

  const toggleUnit = useCallback(async () => {
    await EnhancedHaptics.successHaptic();
    setDisplayBtc(((displayBtc + 1) % 4) as DisplayBtcMode);
  }, [displayBtc, setDisplayBtc]);

  const handleCurrencySelect = useCallback(
    (currency: DisplayCurrency) => {
      setDisplayCurrency(currency);
    },
    [setDisplayCurrency]
  );

  const currencyConfig = CURRENCY_CONFIG[displayCurrency];
  const fiatValue = btcPrice ? ((btcPrice / 100_000_000) * balance).toFixed(2) : null;

  // Render the fiat value badge with context menu for currency selection
  const renderFiatBadge = () => {
    // if (!fiatValue) return null;

    const displayText = `≈ ${currencyConfig.symbol}${fiatValue}`;

    // Use SwiftUI ContextMenu with liquid glass button on iOS
    if (Platform.OS === 'ios') {
      return (
        <Host style={{ marginTop: -16, zIndex: 10 }} matchContents fixedSize={true}>
          <ContextMenu>
            <ContextMenu.Items>
              <SwiftUIButton systemImage="dollarsign" onPress={() => handleCurrencySelect('usd')}>
                USD
              </SwiftUIButton>
              <SwiftUIButton systemImage="eurosign" onPress={() => handleCurrencySelect('eur')}>
                EUR
              </SwiftUIButton>
              <SwiftUIButton systemImage="sterlingsign" onPress={() => handleCurrencySelect('gbp')}>
                GBP
              </SwiftUIButton>
            </ContextMenu.Items>
            <ContextMenu.Trigger>
              <SwiftUIButton
                variant="glass"
                color={getGreenColor('500')}
                modifiers={[frame({ height: 28, alignment: 'center', width: 100 })]}>
                <SwiftUIText
                  design={'monospaced'}
                  weight="bold"
                  color={getGreenColor('300')}
                  size={12}>
                  {displayText}
                </SwiftUIText>
              </SwiftUIButton>
            </ContextMenu.Trigger>
          </ContextMenu>
        </Host>
      );
    }

    // Fallback for non-iOS platforms
    return (
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="mt-[-16px] overflow-hidden rounded-full"
        style={{
          backgroundColor: opacity(getGreenColor('500'), 0.15),
          borderWidth: 1,
          borderColor: opacity(getGreenColor('400'), 0.2),
          paddingHorizontal: 14,
          paddingVertical: 6,
        }}>
        <Text size={12} bold overpass color={getGreenColor('300')} style={{ letterSpacing: 0.3 }}>
          {displayText}
        </Text>
      </HStack>
    );
  };

  return (
    <VStack align="center" className="z-9">
      {renderFiatBadge()}
      <TouchableOpacity onPress={toggleUnit} className="flex-col items-center">
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
      </TouchableOpacity>
    </VStack>
  );
}
