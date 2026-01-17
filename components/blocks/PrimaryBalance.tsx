import React, { useCallback } from 'react';
import { VStack } from 'components/ui/View/VStack';
import { useSettingsStore, DisplayCurrency } from 'stores/settingsStore';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { useBtcPrice } from 'stores/pricelistStore';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useBalanceContext, useMints } from 'coco-cashu-react';
import { FiatCurrencyPill } from 'components/blocks/FiatCurrencyPill';

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
  const { balance: liveBalances } = useBalanceContext();
  const { mints } = useMints();
  const btcPrice = useBtcPrice(displayCurrency);

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

  const currencyConfig = CURRENCY_CONFIG[displayCurrency];
  const fiatValue = btcPrice ? ((btcPrice / 100_000_000) * balance).toFixed(2) : '0.00';

  const displayText = `≈ ${currencyConfig.symbol}${fiatValue}`;

  return (
    <VStack align="center" gap={8} className="z-9">
      <FiatCurrencyPill displayText={displayText} textSize={12} />
      <TouchableOpacity onPress={toggleUnit} className="flex-col items-center">
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
      </TouchableOpacity>
    </VStack>
  );
}
