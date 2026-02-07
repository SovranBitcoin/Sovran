import React, { useCallback, useMemo } from 'react';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { useSettingsStore, DisplayCurrency } from 'stores/settingsStore';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { UntranslatedText } from 'components/ui/Text';
import { useBtcPrice } from 'stores/pricelistStore';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useBalanceContext, useMints, usePaginatedHistory } from 'coco-cashu-react';
import { FiatCurrencyPill } from 'components/blocks/FiatCurrencyPill';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import type { SendHistoryEntry } from 'coco-cashu-core';

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

// ---------------------------------------------------------------------------
// Pending outgoing ecash pill – shows total unclaimed send tokens
// ---------------------------------------------------------------------------

function usePendingEcash() {
  const { history } = usePaginatedHistory();

  return useMemo(() => {
    const pendingSends = history.filter(
      (entry): entry is SendHistoryEntry =>
        entry.type === 'send' && (entry.state === 'pending' || entry.state === 'prepared')
    );

    const totalAmount = pendingSends.reduce((sum, tx) => sum + tx.amount, 0);
    const unit = pendingSends[0]?.unit || 'sat';

    return { totalAmount, unit, count: pendingSends.length };
  }, [history]);
}

function PendingEcashPill(): React.ReactElement | null {
  const { getPrimaryColor } = useTheme();
  const { totalAmount, unit } = usePendingEcash();

  if (totalAmount <= 0) return null;

  const formatted = totalAmount.toLocaleString();

  return (
    <HStack
      align="center"
      justify="center"
      gap={6}
      className="overflow-hidden rounded-full"
      style={{
        backgroundColor: opacity(getPrimaryColor('500'), 0.15),
        borderWidth: 1,
        borderColor: opacity(getPrimaryColor('400'), 0.2),
        paddingHorizontal: 12,
        paddingVertical: 5,
      }}>
      <Icon name="majesticons:coins" size={14} color={getPrimaryColor('200')} />
      <UntranslatedText
        bold
        size={11}
        color={getPrimaryColor('200')}
        style={{ letterSpacing: 0.5 }}>
        {`PENDING: ${formatted} ${unit.toUpperCase()}`}
      </UntranslatedText>
    </HStack>
  );
}

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
      <PendingEcashPill />
    </VStack>
  );
}
