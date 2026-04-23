/**
 * Shared amount-entry shell: centred amount display + optional secondary pill
 * + optional quick-send suggestions + CustomKeyboard + primary Next button.
 *
 * Consumed by the send/receive flow's AmountSelector adapter (machine-driven)
 * and by the Split-Bill step-1 screen (local-state). Keep it framework-neutral:
 * no coco-payment-ux imports, no feature imports that would create cycles.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import opacity from 'hex-color-opacity';

import type { QuickSendSuggestion } from 'coco-payment-ux/react';

import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import CustomKeyboard from '@/shared/ui/composed/CustomKeyboard';
import { FiatCurrencyPill } from '@/features/wallet';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import type { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

export type AmountEntryTransactionType = 'send' | 'receive' | 'neutral';

interface FiatAmountDisplayProps {
  rawInput: string;
  symbol: string;
  activeColor: string;
  placeholderColor: string;
  size: number;
}

function FiatAmountDisplay({
  rawInput,
  symbol,
  activeColor,
  placeholderColor,
  size,
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

export interface AmountEntryViewProps {
  /** Raw keyboard input string; source of truth for CustomKeyboard's internal state. */
  rawInput: string;
  /** Parsed amount as a number (sats when inputMode === 'sat'). */
  numericValue: number;
  /** Display unit passed to AmountFormatter for the sat path. */
  unit: string;
  /** Keyboard unit — 'sat' hides the decimal key; otherwise shows '.'. */
  keyboardUnit: string;
  /** Which display renders: 'sat' uses AmountFormatter, 'fiat' uses FiatAmountDisplay. */
  inputMode: 'sat' | 'fiat';

  /** Required: the keypad fires this with the updated raw string. */
  onKeyPress: (value: string) => void;
  /** Required: primary action when the user taps Next. */
  onNext: () => void | Promise<void>;

  nextLoading?: boolean;
  nextDisabled?: boolean;
  nextText?: string;
  nextTestID?: string;
  nextIcon?: string;

  /** Fiat currency symbol (e.g. '$'). Required when inputMode === 'fiat'. */
  fiatSymbol?: string | null;
  /** Text for the secondary FiatCurrencyPill under the amount. Hides the pill when null. */
  secondaryDisplay?: string | null;
  /** Tap handler for the secondary pill (fiat/sat toggle). */
  onToggleMode?: () => void;

  /** Quick-send suggestions rendered above the keyboard (send flow only). */
  suggestions?: QuickSendSuggestion[];
  onSuggestionTap?: (suggestion: QuickSendSuggestion) => void;

  /** Extra buttons (paste, scan QR, etc.) rendered alongside Next. */
  extraButtons?: ButtonHandlerProps['buttons'];

  /**
   * Color semantics:
   *   'send'    — danger tint on raw input; AmountFormatter uses useTypeColors.
   *   'receive' — foreground; AmountFormatter uses useTypeColors.
   *   'neutral' — foreground; AmountFormatter renders without useTypeColors.
   */
  transactionType?: AmountEntryTransactionType;
}

export function AmountEntryView({
  rawInput,
  numericValue,
  unit,
  keyboardUnit,
  inputMode,
  onKeyPress,
  onNext,
  nextLoading = false,
  nextDisabled = false,
  nextText = 'Next',
  nextTestID = 'amount-next',
  nextIcon = 'lucide:arrow-right',
  fiatSymbol = null,
  secondaryDisplay = null,
  onToggleMode,
  suggestions = [],
  onSuggestionTap,
  extraButtons,
  transactionType = 'neutral',
}: AmountEntryViewProps) {
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

  const isFiat = inputMode === 'fiat';
  const isSend = transactionType === 'send';
  const activeColor = rawInput ? (isSend ? danger : foreground) : opacity(foreground, 0.4);
  const placeholderColor = opacity(isSend ? danger : foreground, 0.35);

  const suggestionsRow = useMemo(() => {
    if (transactionType !== 'send' || suggestions.length === 0) return null;
    return (
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
          //   #amount-chip-send-all         — the "Send all" chip
          //   #amount-chip-<satoshis>        — fixed-amount chips
          //   #amount-chip-fiat-<satoshis>   — fiat-valued chips
          const chipTestID = isSendAll
            ? 'amount-chip-send-all'
            : `amount-chip-${isPrimary ? 'fiat-' : ''}${s.satoshis}`;
          return (
            <Pressable
              key={isSendAll ? 'send-all' : s.satoshis}
              testID={chipTestID}
              onPress={() => onSuggestionTap?.(s)}
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
    );
  }, [transactionType, suggestions, onSuggestionTap, foreground, background]);

  const useTypeColors = transactionType === 'send' || transactionType === 'receive';

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
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
                useTypeColors={useTypeColors}
                transactionType={
                  useTypeColors ? (transactionType as 'send' | 'receive') : undefined
                }
                centered
              />
            )}
            {secondaryDisplay && (
              <FiatCurrencyPill
                displayText={secondaryDisplay}
                onPress={onToggleMode}
                showToggleGlyph
                enableCurrencyMenu={false}
              />
            )}
          </VStack>
        </View>
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={0}>
        {suggestionsRow}
        <CustomKeyboard
          loading={nextLoading}
          unit={keyboardUnit}
          compact={isCompactPhone}
          value={rawInput}
          onKeyPress={onKeyPress}
        />
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                testID: nextTestID,
                text: nextText,
                icon: nextIcon,
                variant: 'primary',
                onPress: async () => {
                  await onNext();
                },
                loading: nextLoading,
                disabled: nextDisabled,
              },
              ...(extraButtons ?? []),
            ]}
          />
        </HStack>
      </BottomButtons>
    </View>
  );
}
