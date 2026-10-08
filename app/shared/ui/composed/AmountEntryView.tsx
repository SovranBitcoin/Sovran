/**
 * Shared amount-entry shell, drawn as a pocket calculator: the amount under
 * the navigation bar, a keypad with a column of function keys, and the Next
 * row.
 *
 * Consumed by the send/receive flow's AmountSelector adapter (machine-driven).
 * Keep it framework-neutral: no colada imports, no feature imports that would
 * create cycles, so any local-state caller can reuse it without the machine.
 */

import { FOOTER_GAP } from '@/shared/ui/composed/footerInset';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text as RNText, useWindowDimensions } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withAlpha } from '@/shared/lib/color';

import type { QuickSendSuggestion } from 'wallet/react';

import { ActionMenuButton, type ActionMenuVariant } from '@/shared/ui/composed/ActionMenuButton';
import { AMOUNT_FONT_FAMILY, AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import CustomKeyboard, { type KeypadFunction } from '@/shared/ui/composed/CustomKeyboard';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
import { cashuLog } from '@/shared/lib/logger';

import type { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

export type AmountEntryTransactionType = 'send' | 'receive' | 'neutral';

/**
 * Whether sending the ecash needs a network, and the sentence that says why.
 * The send feature works it out (`describeSendDelivery`); this screen only
 * shows it.
 */
interface AmountEntryDelivery {
  network: 'not-needed' | 'needed' | 'unknown';
  headline: string;
  detail: string;
}

/** Room for the navigation bar the display runs under, above the status bar. */
const NAV_BAR_ALLOWANCE = 52;

/** How long a function key has to be gone before the keypad drops it. */
const FUNCTION_KEY_SETTLE_MS = 800;

const FIAT_DECIMAL_PLACES = 2;

interface FiatAmountDisplayProps {
  rawInput: string;
  symbol: string;
  activeColor: string;
  placeholderColor: string;
  size: number;
  lineHeight: number;
  align?: 'left' | 'center' | 'right';
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
  align = 'center',
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
        textAlign: align,
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
  /** Parsed amount as a number (sats when the sat account types in unit mode). */
  numericValue: number;
  /** Display unit passed to AmountFormatter for the sat path. */
  unit: string;
  /** Keyboard unit — 'sat' hides the decimal key; otherwise shows '.'. */
  keyboardUnit: string;
  /**
   * 'unit' types in the account unit (sats, or major-denomination fiat when
   * `unitSymbol` is set); 'fiat' is the sat account's display-currency entry.
   */
  inputMode: 'unit' | 'fiat';

  /** Required: the keypad fires this with the updated raw string. */
  onKeyPress: (value: string) => void;
  /** Required: primary action when the user taps Next. */
  onNext: () => void | Promise<void>;

  nextLoading?: boolean;
  nextDisabled?: boolean;
  nextText?: string;
  nextTestID?: string;
  /**
   * True when the entered amount exceeds the spendable balance. The owning
   * adapter derives this from the payment engine (colada) rather than this
   * primitive guessing from a notice string, because an over-balance ecash
   * send still resolves (it rounds down to the balance) and so produces no
   * blocking `noticeText`. Tints the amount danger like any other problem.
   */
  exceedsBalance?: boolean;
  noticeText?: string | null;
  /**
   * Persistent, warning-tinted notice under the amount (e.g. the Nut-Drop
   * "sent over public mesh, anyone can claim" disclaimer). Distinct from the
   * danger-tinted, condition-driven `noticeText`.
   */
  warningText?: string | null;

  /** Fiat currency symbol (e.g. '$'). Required when inputMode === 'fiat'. */
  fiatSymbol?: string | null;
  /**
   * Symbol of the ACCOUNT unit itself ('$'/'€'/'£' on fiat accounts, '' or
   * unset on sat). When set, unit-mode entry renders as major-denomination
   * decimals via FiatAmountDisplay instead of the sat AmountFormatter.
   */
  unitSymbol?: string | null;
  /** The amount in the other currency ("≈ $1.20"). Null when there is none. */
  secondaryDisplay?: string | null;
  /** The swap key's handler (fiat/sat toggle). */
  onToggleMode?: () => void;
  /**
   * Node rendered in the pill slot when there is no display-currency toggle
   * (fiat accounts): the account/unit indicator with its own switcher (e.g.
   * `<UnitSwitcherPill />`). Caller-supplied so this primitive stays free of
   * feature imports.
   */
  unitIndicator?: React.ReactNode;

  /**
   * Quick amounts (send flow only). Only the whole-balance one is used here,
   * as the MAX key; the rest are reached through the note picker.
   */
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
   * Gates the quick-send suggestions row (send only). It does NOT affect the
   * amount colour — the amount is neutral foreground on send and receive
   * alike, going `danger` only on a genuine problem (#214).
   */
  transactionType?: AmountEntryTransactionType;

  /**
   * Delivery status for an ecash payment: an offline mark beside the amount
   * when it can leave with no network, and the sentence behind it on a tap.
   * Null when the payment is not ecash and there is nothing to say.
   */
  delivery?: AmountEntryDelivery | null;
  /** Short name of the currency the swap key switches to ("USD", "sats"). */
  swapLabel?: string;
  /** Opens the note picker. Set only when the wallet holds notes to pick. */
  onPickNotes?: () => void;
  /** Extra room to leave under the navigation bar (a recipient's name band). */
  topClearance?: number;
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
  exceedsBalance = false,
  noticeText = null,
  warningText = null,
  fiatSymbol = null,
  unitSymbol = null,
  secondaryDisplay = null,
  onToggleMode,
  unitIndicator = null,
  suggestions = [],
  onSuggestionTap,
  extraButtons,
  nextVariants,
  leadingBottomButton,
  transactionType = 'neutral',
  delivery = null,
  swapLabel,
  onPickNotes,
  topClearance = 0,
}: AmountEntryViewProps) {
  const [foreground, danger, warning, success] = useThemeColor([
    'foreground',
    'danger',
    'warning',
    'success',
  ] as const);
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const isCompactPhone = screenHeight <= 760;
  const [explained, setExplained] = useState(false);
  // The amount is centred in the space between the navigation bar and the
  // keypad. The bar's share is a fixed allowance over the status-bar inset,
  // not its measured height: the measurement arrives a frame late and is then
  // corrected, and an amount positioned off it visibly slid as the screen
  // opened. Centring also halves whatever error the allowance has.
  const displayInset = { paddingTop: insets.top + NAV_BAR_ALLOWANCE + topClearance };

  // The decimal-money display serves two paths: the sat account's
  // display-currency mode (symbol = fiatSymbol) and a fiat account's native
  // unit mode (symbol = unitSymbol). Everything else is the sat formatter.
  const displaySymbol = inputMode === 'fiat' ? fiatSymbol : unitSymbol || null;
  const accessibilityAmountValue = rawInput.length > 0 ? rawInput : String(numericValue);
  const accessibilityAmountUnit = displaySymbol ?? unit;
  // The amount is neutral foreground on BOTH send and receive — the colour
  // encodes only validity, never transaction direction.
  //   • nothing typed yet (empty input) → a dimmed foreground placeholder "0".
  //   • genuine problem — what the user typed can't proceed (a danger notice,
  //     or an amount that exceeds the spendable balance) → danger, so the
  //     number and its notice move in lockstep and red reliably means
  //     "something's wrong with this amount".
  //   • otherwise (anything typed, including "0"/"0.") → full foreground.
  // Dimming is reserved for the empty placeholder and the fiat decimal prefill
  // ("00") so the digits the user actually typed always read at full contrast
  // (#214). One decision drives both the fiat raw-input path and the BTC glyph
  // path (passed to AmountFormatter via `color`).
  const hasInput = rawInput.length > 0;
  const hasNotice = noticeText != null && noticeText.length > 0;
  const hasWarning = warningText != null && warningText.length > 0;
  const isProblem = hasInput && (hasNotice || exceedsBalance);
  const amountColor = !hasInput ? withAlpha(foreground, 0.4) : isProblem ? danger : foreground;
  const placeholderColor = withAlpha(foreground, 0.35);
  const quiet = withAlpha(foreground, 0.55);

  // One line, right-aligned, sized to stay on it: the digits, the group
  // separators the formatter adds, and the currency sign or unit word.
  const wholeDigits = Math.max(1, rawInput.split('.')[0]?.length ?? 1);
  const glyphs = Math.max(1, rawInput.length) + Math.floor((wholeDigits - 1) / 3) + 5;
  const amountSize = Math.max(
    28,
    Math.min(isCompactPhone ? 48 : 58, Math.floor((screenWidth - 40) / (glyphs * 0.62)))
  );
  const amountLineHeight = Math.round(amountSize * 1.2);

  const offline = delivery?.network === 'not-needed';

  const max = transactionType === 'send' ? suggestions.find((s) => s.sendAll) : undefined;
  const tapSuggestion = (s: QuickSendSuggestion, chipTestID: string) => {
    cashuLog.info('amount_entry.suggestion.press', {
      chipTestID,
      inputMode: s.inputMode,
      amountValue: s.amount.value,
      amountUnit: s.amount.unit,
      sendAll: !!s.sendAll,
      hasHandler: !!onSuggestionTap,
    });
    onSuggestionTap?.(s);
  };

  const logNextPress = useCallback(
    (source: 'plain' | 'leading-row') => {
      cashuLog.info('amount_entry.next.press', {
        source,
        transactionType,
        inputMode,
        rawInputLength: rawInput.length,
        numericValue,
        unit,
        nextDisabled,
        nextLoading,
        hasNextVariants: !!nextVariants?.length,
        extraButtonCount: extraButtons?.length ?? 0,
        hasLeadingBottomButton: !!leadingBottomButton,
      });
    },
    [
      extraButtons?.length,
      inputMode,
      leadingBottomButton,
      nextDisabled,
      nextLoading,
      nextVariants?.length,
      numericValue,
      rawInput.length,
      transactionType,
      unit,
    ]
  );
  const handleKeyPress = useCallback(
    (value: string) => {
      cashuLog.debug('amount_entry.keyboard.input', {
        transactionType,
        inputMode,
        previousLength: rawInput.length,
        nextLength: value.length,
        numericValue,
        unit,
      });
      onKeyPress(value);
    },
    [inputMode, numericValue, onKeyPress, rawInput.length, transactionType, unit]
  );
  const handleToggleMode = useCallback(() => {
    cashuLog.info('amount_entry.mode.toggle', {
      transactionType,
      inputMode,
      rawInputLength: rawInput.length,
      numericValue,
      hasToggleHandler: !!onToggleMode,
    });
    onToggleMode?.();
  }, [inputMode, numericValue, onToggleMode, rawInput.length, transactionType]);

  useEffect(() => {
    cashuLog.debug('amount_entry.render_state', {
      transactionType,
      inputMode,
      unit,
      keyboardUnit,
      rawInputLength: rawInput.length,
      numericValue,
      nextDisabled,
      nextLoading,
      hasNotice: !!noticeText,
      hasWarning: !!warningText,
      suggestionCount: suggestions.length,
      nextVariantCount: nextVariants?.length ?? 0,
      extraButtonCount: extraButtons?.length ?? 0,
      hasLeadingBottomButton: !!leadingBottomButton,
      isCompactPhone,
    });
  }, [
    extraButtons?.length,
    inputMode,
    isCompactPhone,
    keyboardUnit,
    leadingBottomButton,
    nextDisabled,
    nextLoading,
    nextVariants?.length,
    noticeText,
    numericValue,
    rawInput.length,
    suggestions.length,
    transactionType,
    unit,
    warningText,
  ]);

  // Both display paths take the same explicit line height, so toggling
  // fiat ↔ sat can't jitter the rendered height. RN otherwise uses the font's
  // intrinsic metric, which differs by face and weight.
  const footer = (
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
        <HStack align="center" gap={FOOTER_GAP} style={styles.bottomRow}>
          {leadingBottomButton ? (
            <View style={styles.bottomSlotCentered}>{leadingBottomButton}</View>
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
            <View style={styles.bottomSlot}>
              <Button
                testID={extraButtons[0].testID}
                text={extraButtons[0].text}
                variant={extraButtons[0].variant}
                loading={extraButtons[0].loading}
                disabled={extraButtons[0].disabled}
                onPress={() => {
                  cashuLog.info('amount_entry.extra_button.press', {
                    index: 0,
                    testID: extraButtons[0].testID ?? null,
                    disabled: extraButtons[0].disabled ?? false,
                    loading: extraButtons[0].loading ?? false,
                  });
                  void extraButtons[0].onPress?.();
                }}
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
                onPress={() => {
                  cashuLog.info('amount_entry.extra_button.press', {
                    index: 1,
                    testID: extraButtons[1].testID ?? null,
                    disabled: extraButtons[1].disabled ?? false,
                    loading: extraButtons[1].loading ?? false,
                  });
                  void extraButtons[1].onPress?.();
                }}
              />
            </View>
          ) : null}
        </HStack>
      ) : leadingBottomButton ? (
        // Recipient-header flow: render the 50/50 row directly so the
        // caller-supplied leading node (e.g. MintSelector pill) can
        // render its own image-backed chrome without this primitive
        // needing to model mint internals.
        <HStack align="center" gap={FOOTER_GAP} style={styles.bottomRow}>
          <View style={styles.bottomSlotCentered}>{leadingBottomButton}</View>
          <View style={styles.bottomSlot}>
            <Button
              testID={nextTestID}
              text={nextText}
              variant="primary"
              loading={nextLoading}
              disabled={nextDisabled}
              onPress={async () => {
                logNextPress('leading-row');
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
              variant: 'primary',
              onPress: async () => {
                logNextPress('plain');
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
  );

  // Which function keys exist settles before it shrinks. A send reserves the
  // wallet's notes and reloads its proofs, so "is there a whole balance" can
  // go false and true again within a few frames, and the busy flag dips
  // between the machine's steps too. A key that appears does so at once; one
  // that goes away has to stay away for a moment first, so the column never
  // resizes for a flicker.
  const offered = `${secondaryDisplay && swapLabel ? 's' : ''}${max ? 'm' : ''}${onPickNotes ? 'n' : ''}`;
  const [shown, setShown] = useState(offered);
  useEffect(() => {
    if (offered === shown) return;
    const grows = [...shown].every((key) => offered.includes(key));
    if (grows) {
      setShown(offered);
      return;
    }
    const timer = setTimeout(() => setShown(offered), FUNCTION_KEY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [offered, shown]);

  const functions: KeypadFunction[] = [];
  if (shown.includes('s')) {
    functions.push({
      testID: 'amount-currency-swapper',
      accessibilityLabel: `Type in ${swapLabel ?? 'the other currency'} instead`,
      icon: 'fluent:arrow-swap-16-filled',
      label: swapLabel ?? '',
      onPress: handleToggleMode,
    });
  }
  if (shown.includes('m')) {
    functions.push({
      testID: 'amount-chip-send-all',
      accessibilityLabel: 'Send all',
      label: 'MAX',
      onPress: () => {
        if (max) tapSuggestion(max, 'amount-chip-send-all');
      },
    });
  }
  if (shown.includes('n')) {
    functions.push({
      testID: 'amount-pick-notes',
      accessibilityLabel: 'Pick notes',
      icon: 'mdi:cash-multiple',
      onPress: () => onPickNotes?.(),
    });
  }

  return (
    <View className="bg-surface flex-1">
      {/* The display: the amount and one line beneath it, centred in the
          space between the navigation bar and the keys. */}
      <View className="flex-1 items-center justify-center px-5" style={displayInset}>
        <View
          testID="amount-value"
          accessible
          accessibilityRole="text"
          accessibilityLabel={`Amount ${accessibilityAmountValue} ${accessibilityAmountUnit}`}
          accessibilityValue={{ text: accessibilityAmountValue }}
          collapsable={false}
          className="items-center">
          {displaySymbol ? (
            <FiatAmountDisplay
              rawInput={rawInput}
              symbol={displaySymbol}
              size={amountSize}
              lineHeight={amountLineHeight}
              activeColor={amountColor}
              placeholderColor={placeholderColor}
            />
          ) : (
            <AmountFormatter
              amount={numericValue}
              unit={unit}
              size={amountSize}
              lineHeight={amountLineHeight}
              weight="heavy"
              color={amountColor}
              centered
            />
          )}
        </View>
        {/* Android merges accessibilityLabel + accessibilityValue into one
            content-desc, so the visible amount node cannot provide an
            exact cross-platform value signal. Encode the semantic state
            in a harness-only sibling testID instead; keypad retries can
            observe a landed digit without duplicating spoken production
            content or risking a blind duplicate tap. */}
        {__DEV__ && process.env.EXPO_PUBLIC_E2E_STATE_MIRROR === '1' ? (
          <View
            testID={`amount-state:${accessibilityAmountValue}`}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Amount state ${accessibilityAmountValue}`}
            importantForAccessibility="yes"
            collapsable={false}
            pointerEvents="none"
            style={styles.amountStateProbe}
          />
        ) : null}

        {/* One line under the amount, and one thing on it at a time: what is
            wrong with the amount, else a caution, else the tapped-for
            explanation, else the amount in the other currency with the
            offline mark beside it. Tapping it swaps in the explanation. */}
        <Pressable
          testID="amount-delivery"
          accessible={false}
          disabled={!delivery}
          activeOpacity={1}
          hitSlop={12}
          onPress={() => setExplained((value) => !value)}
          className="min-h-[22px] flex-row items-center justify-center gap-2">
          {hasNotice ? (
            <Text size={13} bold color={danger} numberOfLines={2} className="text-center">
              {noticeText}
            </Text>
          ) : hasWarning ? (
            <Text size={12} color={warning} numberOfLines={2} className="text-center">
              {warningText}
            </Text>
          ) : delivery && explained ? (
            <Text size={12} color={quiet} numberOfLines={2} className="text-center">
              {delivery.headline}. {delivery.detail}
            </Text>
          ) : (
            <>
              {secondaryDisplay ? (
                <Text family="mono" size={13} color={quiet}>
                  {secondaryDisplay}
                </Text>
              ) : (
                unitIndicator
              )}
              {offline ? (
                <View className="flex-row items-center gap-1">
                  <Icon name="mdi:airplane" size={12} color={success} />
                  <Text family="mono" size={11} bold color={success}>
                    OFFLINE
                  </Text>
                </View>
              ) : null}
            </>
          )}
          {/* Always here for an ecash payment, lit or not, so the harness and
              a screen reader can read the state without it being on screen. */}
          {delivery ? (
            <View
              testID="amount-flag-offline"
              accessible
              accessibilityRole="text"
              accessibilityLabel={offline ? 'No internet needed' : delivery.headline}
              // The line above explains itself on a tap, which a screen reader
              // cannot give it; the explanation is read here instead.
              accessibilityHint={delivery.detail}
              accessibilityState={{ selected: offline }}
              collapsable={false}
              style={styles.amountStateProbe}
            />
          ) : null}
        </Pressable>
      </View>

      <BottomButtons style={styles.bottomButtons} paddingBottom={0}>
        <CustomKeyboard
          loading={nextLoading}
          unit={keyboardUnit}
          compact={isCompactPhone}
          value={rawInput}
          onKeyPress={handleKeyPress}
          functions={functions}
        />
        {footer}
      </BottomButtons>
    </View>
  );
}

const styles = StyleSheet.create({
  amountStateProbe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  },
  bottomButtons: {
    // Overrides BottomButtons' own `position: 'absolute'` container so the
    // buttons sit in normal flow inside the amount-entry column.
    position: 'relative',
  },
  bottomRow: {
    flex: 1,
  },
  bottomSlot: {
    flex: 1,
  },
  bottomSlotCentered: {
    flex: 1,
    alignItems: 'center',
  },
});
