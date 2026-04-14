/**
 * Amount input — pure UI. Input state and availability come from
 * `useScreenActions('amountEntry', …)` (amount entry screen manager).
 */

import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import opacity from 'hex-color-opacity';
import { walletLog, useLifecycleLogger, Screen } from '@/shared/lib/logger';

import type { ScreenActionName } from 'coco-payment-ux';
import type { BoundAction, QuickSendSuggestion } from 'coco-payment-ux/react';

import { CustomKeyboard } from '@/features/auth';
import { FiatCurrencyPill } from '@/features/wallet';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import type { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

type AmountEntryActions = Record<ScreenActionName['amountEntry'], BoundAction>;

// ---------------------------------------------------------------------------
// FiatAmountDisplay — styled fiat amount with decimal placeholders
// ---------------------------------------------------------------------------

interface FiatAmountDisplayProps {
  rawInput: string;
  symbol: string;
  activeColor: string;
  placeholderColor: string;
  size?: number;
}

function FiatAmountDisplay({
  rawInput,
  symbol,
  activeColor,
  placeholderColor,
  size = 48,
}: FiatAmountDisplayProps) {
  const hasDecimal = rawInput.includes('.');
  const parts = rawInput.split('.');
  const wholePart = parts[0] || '';
  const decimalPart = parts[1] || '';

  const parsedWhole = parseInt(wholePart, 10);
  const formattedWhole = !isNaN(parsedWhole) ? parsedWhole.toLocaleString('en-US') : '0';

  const showDecimalSection = hasDecimal || wholePart === '0';
  const placeholderDecimals = showDecimalSection
    ? '0'.repeat(Math.max(0, 2 - decimalPart.length))
    : '';

  return (
    <HStack align="baseline" justify="center">
      <Text overpass size={size} weight="heavy" style={{ color: activeColor }}>
        {symbol}
        {formattedWhole}
      </Text>
      {showDecimalSection && (
        <>
          <Text
            overpass
            size={size}
            weight="heavy"
            style={{ color: hasDecimal ? activeColor : placeholderColor }}>
            .
          </Text>
          {decimalPart && (
            <Text overpass size={size} weight="heavy" style={{ color: activeColor }}>
              {decimalPart}
            </Text>
          )}
          {placeholderDecimals && (
            <Text overpass size={size} weight="heavy" style={{ color: placeholderColor }}>
              {placeholderDecimals}
            </Text>
          )}
        </>
      )}
    </HStack>
  );
}

function readAmountEntryFields(entry: Record<string, unknown>) {
  const rawInput = typeof entry.rawInput === 'string' ? entry.rawInput : '';
  const inputMode = entry.inputMode === 'fiat' ? 'fiat' : 'sat';
  const numericValue = typeof entry.numericValue === 'number' ? entry.numericValue : 0;
  const keyboardUnit = typeof entry.keyboardUnit === 'string' ? entry.keyboardUnit : 'sat';
  const unit = typeof entry.unit === 'string' ? entry.unit : 'sat';
  const secondaryDisplay =
    typeof entry.secondaryDisplay === 'string' ? entry.secondaryDisplay : null;
  const fiatSymbol = typeof entry.fiatSymbol === 'string' ? entry.fiatSymbol : null;
  const canSendOffline = typeof entry.canSendOffline === 'boolean' ? entry.canSendOffline : null;

  return {
    rawInput,
    inputMode,
    numericValue,
    keyboardUnit,
    unit,
    secondaryDisplay,
    fiatSymbol,
    canSendOffline,
  };
}

// ---------------------------------------------------------------------------
// AmountSelector
// ---------------------------------------------------------------------------

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

  const [foreground, background, danger] = useThemeColor([
    'foreground',
    'background',
    'danger',
  ] as const);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isCompactPhone = screenHeight <= 760;
  const isVeryCompactPhone = screenHeight <= 680;
  const amountTextSize = isVeryCompactPhone ? 36 : isCompactPhone ? 42 : 48;
  const centerSpacing = isCompactPhone ? 3 : 4;
  const topPadding = insets.top + (isCompactPhone ? 12 : 24);

  const { rawInput, inputMode, numericValue, keyboardUnit, unit, secondaryDisplay, fiatSymbol } =
    useMemo(() => readAmountEntryFields(entry), [entry]);

  const isFiat = inputMode === 'fiat';
  const isSend = transactionType === 'send';

  const activeColor = rawInput ? (isSend ? danger : foreground) : opacity(foreground, 0.4);
  const placeholderColor = opacity(isSend ? danger : foreground, 0.35);

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

  const nextLoading = machineBusy || actions.next.loading;
  const nextDisabled = !actions.next.available;

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

  return (
    <Screen name="AmountSelector" style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1, paddingTop: topPadding, paddingHorizontal: 16 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VStack align="center" spacing={centerSpacing}>
            {isFiat && fiatSymbol ? (
              <FiatAmountDisplay
                rawInput={rawInput}
                symbol={fiatSymbol}
                size={amountTextSize}
                activeColor={activeColor}
                placeholderColor={placeholderColor}
              />
            ) : (
              <AmountFormatter
                amount={numericValue}
                unit={unit}
                size={amountTextSize}
                weight="heavy"
                animated
                useTypeColors
                transactionType={transactionType}
                centered
              />
            )}
            {secondaryDisplay && (
              <FiatCurrencyPill
                displayText={secondaryDisplay}
                onPress={handleToggle}
                showToggleGlyph
                enableCurrencyMenu={false}
              />
            )}
          </VStack>
        </View>
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={0}>
        {isSend && suggestions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 10,
              gap: 8,
            }}>
            {suggestions.map((s) => {
              const isPrimary = s.inputMode === 'fiat';
              const isSendAll = !!s.sendAll;
              // testID convention:
              //   #amount-chip-send-all               — the "Send all" chip
              //   #amount-chip-<satoshis>              — fixed-amount chips
              //   #amount-chip-fiat-<satoshis>         — fiat-valued chips
              // Stable across copy changes and theme tweaks; tests drive the
              // matrix via these ids rather than matching on the visible label.
              const chipTestID = isSendAll
                ? 'amount-chip-send-all'
                : `amount-chip-${isPrimary ? 'fiat-' : ''}${s.satoshis}`;
              return (
                <Pressable
                  key={isSendAll ? 'send-all' : s.satoshis}
                  testID={chipTestID}
                  onPress={() => handleSuggestionTap(s)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 20,
                    backgroundColor: isPrimary ? foreground : opacity(foreground, 0.06),
                    opacity: pressed ? 0.6 : 1,
                  })}>
                  {isPrimary ? (
                    <Text size={13} weight="bold" style={{ color: background }}>
                      {s.label}
                    </Text>
                  ) : isSendAll ? (
                    <HStack align="center" spacing={4}>
                      <Text size={13} weight="heavy" style={{ color: foreground }}>
                        Send all
                      </Text>
                      <AmountFormatter
                        amount={s.satoshis}
                        unit="sat"
                        size={13}
                        weight="heavy"
                        color={foreground}
                      />
                    </HStack>
                  ) : (
                    <AmountFormatter
                      amount={s.satoshis}
                      unit="sat"
                      size={13}
                      weight="heavy"
                      color={foreground}
                    />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <CustomKeyboard
          loading={nextLoading}
          unit={keyboardUnit}
          compact={isCompactPhone}
          value={rawInput}
          onKeyPress={handleKeyPress}
        />
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                testID: 'amount-next',
                text: 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                loading: nextLoading,
                disabled: nextDisabled,
              },
              ...extraButtons,
            ]}
          />
        </HStack>
      </BottomButtons>
    </Screen>
  );
}
