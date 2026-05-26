/**
 * Split-Bill step 1: enter the total amount to split.
 *
 * Local-state consumer of the shared `AmountEntryView` primitive. Sat/fiat
 * toggle, keyboard-unit switching, and secondary-display formatting all come
 * from `useLocalAmountEntry`, which wraps colada's
 * `createAmountActionManager` — identical math to the send/receive flow.
 */

import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { AmountEntryView } from '@/shared/ui/composed/AmountEntryView';
import { useLocalAmountEntry } from '@/shared/hooks/useLocalAmountEntry';
import { Log, useLifecycleLogger, useRenderLogger, walletLog } from '@/shared/lib/logger';

export default function SplitBillAmountScreen() {
  useLifecycleLogger('SplitBillAmountScreen', walletLog);
  // Amount entry is a hot keypress loop — warn if re-renders exceed 80 over
  // the screen's lifetime (roughly: 30+ keypresses + price ticks + lifecycle).
  useRenderLogger('SplitBillAmountScreen', 80, walletLog);
  const router = useRouter();

  const {
    rawInput,
    inputMode,
    numericValue,
    unit,
    keyboardUnit,
    secondaryDisplay,
    fiatSymbol,
    effectiveSatAmount,
    onKeyPress,
    onToggleMode,
  } = useLocalAmountEntry({ unit: 'sat' });

  const handleNext = useCallback(async () => {
    if (effectiveSatAmount <= 0) return;
    walletLog.info('split_bill.amount.next', {
      sats: effectiveSatAmount,
      inputMode,
    });
    router.push({
      pathname: '/(split-bill-flow)/participants',
      params: { totalAmount: String(effectiveSatAmount), unit: 'sat' },
    });
  }, [effectiveSatAmount, inputMode, router]);

  return (
    <Log name="SplitBillAmountScreen" style={{ flex: 1 }}>
      <AmountEntryView
        rawInput={rawInput}
        numericValue={numericValue}
        unit={unit}
        keyboardUnit={keyboardUnit}
        inputMode={inputMode}
        onKeyPress={onKeyPress}
        onNext={handleNext}
        nextDisabled={effectiveSatAmount <= 0}
        nextTestID="split-bill-amount-next"
        transactionType="receive"
        fiatSymbol={fiatSymbol}
        secondaryDisplay={secondaryDisplay}
        onToggleMode={onToggleMode}
      />
    </Log>
  );
}
