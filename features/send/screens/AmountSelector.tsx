/**
 * Machine-driven adapter over the shared AmountEntryView primitive.
 * Unpacks coco-payment-ux's amountEntry screen state into the primitive's
 * typed contract and wires the bound actions through.
 */

import { useCallback, useMemo } from 'react';

import type { ScreenActionName } from 'coco-payment-ux';
import type { BoundAction, QuickSendSuggestion } from 'coco-payment-ux/react';

import {
  AmountEntryView,
  type AmountEntryTransactionType,
} from '@/shared/ui/composed/AmountEntryView';
import { Screen, useLifecycleLogger, walletLog } from '@/shared/lib/logger';

import type { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

type AmountEntryActions = Record<ScreenActionName['amountEntry'], BoundAction>;

function readAmountEntryFields(entry: Record<string, unknown>) {
  const rawInput = typeof entry.rawInput === 'string' ? entry.rawInput : '';
  const inputMode: 'sat' | 'fiat' = entry.inputMode === 'fiat' ? 'fiat' : 'sat';
  const numericValue = typeof entry.numericValue === 'number' ? entry.numericValue : 0;
  const keyboardUnit = typeof entry.keyboardUnit === 'string' ? entry.keyboardUnit : 'sat';
  const unit = typeof entry.unit === 'string' ? entry.unit : 'sat';
  const secondaryDisplay =
    typeof entry.secondaryDisplay === 'string' ? entry.secondaryDisplay : null;
  const fiatSymbol = typeof entry.fiatSymbol === 'string' ? entry.fiatSymbol : null;

  return {
    rawInput,
    inputMode,
    numericValue,
    keyboardUnit,
    unit,
    secondaryDisplay,
    fiatSymbol,
  };
}

export interface AmountSelectorProps {
  entry: Record<string, unknown>;
  actions: AmountEntryActions;
  suggestions?: QuickSendSuggestion[];
  transactionType: 'send' | 'receive';
  /** True while the payment machine is busy (e.g. after Next). */
  machineBusy?: boolean;
}

export function AmountSelector({
  entry,
  actions,
  suggestions = [],
  transactionType,
  machineBusy = false,
}: AmountSelectorProps) {
  useLifecycleLogger('AmountSelector', walletLog);

  const { rawInput, inputMode, numericValue, keyboardUnit, unit, secondaryDisplay, fiatSymbol } =
    useMemo(() => readAmountEntryFields(entry), [entry]);

  const handleKeyPress = useCallback(
    (value: string) => {
      walletLog.debug('amount.input.key', { value, inputMode });
      void actions.setInput.execute({ input: value });
    },
    [actions.setInput, inputMode]
  );

  const handleSuggestionTap = useCallback(
    (suggestion: QuickSendSuggestion) => {
      walletLog.info('amount.suggestion.tap', {
        satoshis: suggestion.satoshis,
        label: suggestion.label,
        mode: suggestion.inputMode,
      });
      void actions.setInput.execute({
        input: suggestion.inputValue,
        mode: suggestion.inputMode,
      });
    },
    [actions.setInput]
  );

  const handleToggle = useCallback(() => {
    walletLog.info('amount.input.toggle', { fromMode: inputMode });
    void actions.toggle.execute();
  }, [actions.toggle, inputMode]);

  const handleNext = useCallback(async () => {
    walletLog.info('amount.next', { numericValue, inputMode, unit, transactionType });
    await actions.next.execute();
  }, [actions.next, numericValue, inputMode, unit, transactionType]);

  const extraButtons = useMemo((): ButtonHandlerProps['buttons'] => {
    const buttons: ButtonHandlerProps['buttons'] = [];
    if (actions.paste.available) {
      buttons.push({
        testID: 'amount-paste',
        text: 'Paste',
        icon: 'lets-icons:copy',
        variant: 'secondary',
        onPress: async () => {
          walletLog.info('amount.paste');
          await actions.paste.execute();
        },
        loading: actions.paste.loading,
      });
    }
    if (actions.scanQr.available) {
      buttons.push({
        testID: 'amount-scan-qr',
        text: 'Scan QR',
        icon: 'stash:qr-code',
        variant: 'secondary',
        onPress: async () => {
          walletLog.info('amount.scan_qr');
          await actions.scanQr.execute();
        },
        loading: actions.scanQr.loading,
      });
    }
    return buttons;
  }, [actions.paste, actions.scanQr]);

  const nextLoading = machineBusy || actions.next.loading;
  const nextDisabled = !actions.next.available;
  const transactionTypeForView: AmountEntryTransactionType = transactionType;

  return (
    <Screen name="AmountSelector" style={{ flex: 1 }}>
      <AmountEntryView
        rawInput={rawInput}
        numericValue={numericValue}
        unit={unit}
        keyboardUnit={keyboardUnit}
        inputMode={inputMode}
        onKeyPress={handleKeyPress}
        onNext={handleNext}
        nextLoading={nextLoading}
        nextDisabled={nextDisabled}
        nextTestID="amount-next"
        fiatSymbol={fiatSymbol}
        secondaryDisplay={secondaryDisplay}
        onToggleMode={handleToggle}
        suggestions={suggestions}
        onSuggestionTap={handleSuggestionTap}
        extraButtons={extraButtons}
        transactionType={transactionTypeForView}
      />
    </Screen>
  );
}
