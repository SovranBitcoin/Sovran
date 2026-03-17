/**
 * Amount input component — pure UI, zero state.
 *
 * All input state and display values are owned by the AmountActionManager
 * (via useAmountActions). This component just renders what the manager
 * provides and forwards keyboard events back to it.
 */

import { useCallback } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import opacity from 'hex-color-opacity';

import type { UseAmountActionsResult } from 'coco-payment-ux/react';

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

// ---------------------------------------------------------------------------
// AmountSelector
// ---------------------------------------------------------------------------

export interface AmountSelectorProps {
  /** Amount state + actions from useAmountActions. */
  amount: UseAmountActionsResult;
  transactionType: 'send' | 'receive';
  onSubmit: () => void;
  loading?: boolean;
  /** Slot for extra buttons (e.g. Paste / Scan QR) rendered alongside Next. */
  extraButtons?: ButtonHandlerProps['buttons'];
}

export function AmountSelector({
  amount,
  transactionType,
  onSubmit,
  loading = false,
  extraButtons = [],
}: AmountSelectorProps) {
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

  const isFiat = amount.inputMode === 'fiat';
  const isSend = transactionType === 'send';

  // Fiat display colors
  const activeColor = amount.rawInput ? (isSend ? danger : foreground) : opacity(foreground, 0.4);
  const placeholderColor = opacity(isSend ? danger : foreground, 0.35);

  const handleNext = useCallback(async () => {
    if (amount.numericValue > 0) onSubmit();
  }, [amount.numericValue, onSubmit]);

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1, paddingTop: topPadding, paddingHorizontal: 16 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VStack align="center" spacing={centerSpacing}>
            {/* Main amount display */}
            {isFiat && amount.fiatSymbol ? (
              <FiatAmountDisplay
                rawInput={amount.rawInput}
                symbol={amount.fiatSymbol}
                size={amountTextSize}
                activeColor={activeColor}
                placeholderColor={placeholderColor}
              />
            ) : (
              <AmountFormatter
                amount={amount.numericValue}
                unit={amount.unit}
                size={amountTextSize}
                weight="heavy"
                animated
                useTypeColors
                transactionType={transactionType}
                centered
              />
            )}
            {/* Secondary converted value with toggle pill */}
            {amount.secondaryDisplay && (
              <FiatCurrencyPill
                displayText={amount.secondaryDisplay}
                onPress={amount.toggle}
                showToggleGlyph
                enableCurrencyMenu={false}
              />
            )}
          </VStack>
        </View>
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={0}>
        <CustomKeyboard
          loading={loading}
          unit={amount.keyboardUnit}
          compact={isCompactPhone}
          value={amount.rawInput}
          onKeyPress={amount.setInput}
        />
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                loading,
                disabled: amount.numericValue <= 0,
              },
              ...extraButtons,
            ]}
          />
        </HStack>
      </BottomButtons>
    </View>
  );
}
