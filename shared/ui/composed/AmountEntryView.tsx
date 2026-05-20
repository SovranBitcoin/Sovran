/**
 * Shared amount-entry shell: centred amount display + optional secondary pill
 * + optional quick-send suggestions + CustomKeyboard + primary Next button.
 *
 * Consumed by the send/receive flow's AmountSelector adapter (machine-driven)
 * and by the Split-Bill step-1 screen (local-state). Keep it framework-neutral:
 * no coco-payment-ux imports, no feature imports that would create cycles.
 */

import { useMemo } from 'react';
import { ScrollView, Text as RNText, useWindowDimensions } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import opacity from 'hex-color-opacity';

import type { QuickSendSuggestion } from 'coco-payment-ux/react';

import { ActionMenuButton, type ActionMenuVariant } from '@/shared/ui/composed/ActionMenuButton';
import { AMOUNT_FONT_FAMILY, AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import CustomKeyboard from '@/shared/ui/composed/CustomKeyboard';
import { CurrencySwapperPill } from '@/features/wallet/components/CurrencySwapperPill';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';

import type { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

export type AmountEntryTransactionType = 'send' | 'receive' | 'neutral';

const FIAT_DECIMAL_PLACES = 2;

interface FiatAmountDisplayProps {
  rawInput: string;
  symbol: string;
  activeColor: string;
  placeholderColor: string;
  size: number;
  lineHeight: number;
}

/**
 * Renders the in-progress fiat raw input (e.g. "$1,234.5") as a single text
 * node so its line-box height matches AmountFormatter's sat path exactly —
 * same MonaSans face, same explicit lineHeight. Toggling between fiat and
 * sat modes therefore can't shift the display vertically. Greyed-out trailing
 * zeros are nested <RNText> children, which inherit the parent's metrics
 * instead of opening a new flex line.
 */
function FiatAmountDisplay({
  rawInput,
  symbol,
  activeColor,
  placeholderColor,
  size,
  lineHeight,
}: FiatAmountDisplayProps) {
  const hasDecimal = rawInput.includes('.');
  const [wholeRaw = '', decimalPart = ''] = rawInput.split('.');
  const parsedWhole = parseInt(wholeRaw, 10);
  const formattedWhole = Number.isNaN(parsedWhole) ? '0' : parsedWhole.toLocaleString('en-US');

  const showDecimalSection = hasDecimal || wholeRaw === '0';
  const placeholderDecimals = showDecimalSection
    ? '0'.repeat(Math.max(0, FIAT_DECIMAL_PLACES - decimalPart.length))
    : '';

  return (
    <RNText
      allowFontScaling={false}
      style={{
        fontFamily: AMOUNT_FONT_FAMILY.heavy,
        fontSize: size,
        lineHeight,
        textAlign: 'center',
        color: activeColor,
        margin: 0,
      }}>
      {`${symbol} ${formattedWhole}`}
      {showDecimalSection && (
        <>
          <RNText style={{ color: hasDecimal ? activeColor : placeholderColor }}>.</RNText>
          {decimalPart}
          {placeholderDecimals !== '' && (
            <RNText style={{ color: placeholderColor }}>{placeholderDecimals}</RNText>
          )}
        </>
      )}
    </RNText>
  );
}

interface AmountEntryViewProps {
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
   * Optional split-button variants for the Next action. When present, Next
   * renders as an ActionMenuButton (primary + chevron → Menu) listing each
   * variant. The first variant's `onPress` is invoked by taps on the primary
   * half; tapping a menu item calls that variant's `onPress`. Leave undefined
   * to keep the plain Next button.
   */
  nextVariants?: ActionMenuVariant[];

  /**
   * Optional leading node rendered to the left of Next at 50% width.
   * Caller-supplied node (e.g. `<MintSelector />`) so the bottom row can
   * mirror the wallet header's pill chrome — including balance, mint icon,
   * and liquid/blur/flat capability variants — without this primitive
   * knowing about mint internals. Wrapped in a `flex:1` View. Suppresses
   * `extraButtons` when set — Paste/Scan-QR are not meaningful once the
   * recipient has been picked.
   */
  leadingBottomButton?: React.ReactNode;

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
  nextVariants,
  leadingBottomButton,
  transactionType = 'neutral',
}: AmountEntryViewProps) {
  const [foreground, background, danger, success] = useThemeColor([
    'foreground',
    'background',
    'danger',
    'success',
  ] as const);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isCompactPhone = screenHeight <= 760;
  const isVeryCompactPhone = screenHeight <= 680;
  const amountTextSize = isVeryCompactPhone ? 36 : isCompactPhone ? 42 : 48;
  // Lock the line-box for both display paths so toggling fiat ↔ sat can't
  // jitter the rendered height. RN otherwise uses the font's intrinsic
  // metric, which differs by face and weight.
  const amountLineHeight = Math.round(amountTextSize * 1.2);
  const centerSpacing = isCompactPhone ? 3 : 4;
  const topPadding = insets.top + (isCompactPhone ? 12 : 24);

  const isFiat = inputMode === 'fiat';
  const isSend = transactionType === 'send';
  const isReceive = transactionType === 'receive';
  // Match `AmountFormatter.resolveColor`: send → danger, receive → success,
  // anything else → foreground. Keeps the fiat raw-input path (which doesn't
  // route through AmountFormatter) in sync with the BTC glyph path.
  const typeTint = isSend ? danger : isReceive ? success : foreground;
  const activeColor = rawInput ? typeTint : opacity(foreground, 0.4);
  const placeholderColor = opacity(typeTint, 0.35);

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
                lineHeight={amountLineHeight}
                activeColor={activeColor}
                placeholderColor={placeholderColor}
              />
            ) : (
              <AmountFormatter
                amount={numericValue}
                unit={unit}
                size={amountTextSize}
                lineHeight={amountLineHeight}
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
              <CurrencySwapperPill inputMode={inputMode} onPress={onToggleMode} />
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
          {nextVariants && nextVariants.length > 0 ? (
            // Variants path — build the full row inline so the original
            // ButtonHandler layout rules are preserved while Next is actually
            // a Menu trigger:
            //   • 1 slot : Next only, flex:1
            //   • 2 slots: Next + extra, both text, flex:1 each
            //   • 3 slots: Next + extra, both text, third extra icon-only
            // This mirrors the plain-ButtonHandler path's "2 text + third
            // collapses to icon" rule we lost when Next got split into its
            // own component.
            //
            // When `leadingBottomButton` is set (recipient-header flow),
            // extras are suppressed and the row becomes [leading 50%] +
            // [ActionMenuButton 50%].
            <HStack align="center" gap={0} style={{ flex: 1 }}>
              {leadingBottomButton ? (
                <View style={{ flex: 1, alignItems: 'center' }}>{leadingBottomButton}</View>
              ) : null}
              <ActionMenuButton
                label={nextText}
                testID={nextTestID}
                variant="primary"
                loading={nextLoading}
                disabled={nextDisabled}
                variants={nextVariants}
                // Bottom-anchored Next button — popover "top" placement pushes
                // the menu too far up the screen (menu height stacks above
                // trigger). Slide up as a bottom-sheet instead.
                presentation="bottom-sheet"
                // Tapping Next always opens the menu instead of firing the
                // first variant directly. Even when only one option is
                // available, the menu surfaces the exact action ("as Ecash" /
                // "as Lightning") so the user knows what's about to happen
                // before an invoice or token is minted.
                collapsedPressOpensMenu
                menuTitle="Select option"
              />
              {!leadingBottomButton && extraButtons && extraButtons.length > 0 ? (
                <View style={{ flex: 1 }}>
                  <Button
                    testID={extraButtons[0].testID}
                    text={extraButtons[0].text}
                    variant={extraButtons[0].variant}
                    loading={extraButtons[0].loading}
                    disabled={extraButtons[0].disabled}
                    onPress={() => extraButtons[0].onPress?.()}
                  />
                </View>
              ) : null}
              {!leadingBottomButton && extraButtons && extraButtons.length > 1 ? (
                <View>
                  <Button
                    testID={extraButtons[1].testID}
                    icon={
                      extraButtons[1].icon ? (
                        <Icon name={extraButtons[1].icon} />
                      ) : (
                        <Icon name="tabler:dots" />
                      )
                    }
                    variant={extraButtons[1].variant ?? 'secondary'}
                    loading={extraButtons[1].loading}
                    disabled={extraButtons[1].disabled}
                    onPress={() => extraButtons[1].onPress?.()}
                  />
                </View>
              ) : null}
            </HStack>
          ) : leadingBottomButton ? (
            // Recipient-header flow: render the 50/50 row directly so the
            // caller-supplied leading node (e.g. MintSelector pill) can
            // render its own image-backed chrome without this primitive
            // needing to model mint internals.
            <HStack align="center" gap={0} style={{ flex: 1 }}>
              <View style={{ flex: 1, alignItems: 'center' }}>{leadingBottomButton}</View>
              <View style={{ flex: 1 }}>
                <Button
                  testID={nextTestID}
                  text={nextText}
                  icon={nextIcon ? <Icon name={nextIcon} /> : undefined}
                  variant="primary"
                  loading={nextLoading}
                  disabled={nextDisabled}
                  onPress={async () => {
                    await onNext();
                  }}
                />
              </View>
            </HStack>
          ) : (
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
          )}
        </HStack>
      </BottomButtons>
    </View>
  );
}
