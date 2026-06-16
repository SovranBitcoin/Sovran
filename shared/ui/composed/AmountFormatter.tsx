import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextStyle,
  ViewStyle,
} from 'react-native';

import opacity from 'hex-color-opacity';
import { LiquidGlassText } from 'liquid-glass-text';
import type { GlassVariant } from 'liquid-glass-text';

import { formatAmount } from '@/shared/lib/currency';
import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import { Log, paymentLog } from '@/shared/lib/logger';
import { cn } from '@/shared/lib/utils';
import { useCapabilities } from '@/shared/ui/capability';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { View } from '@/shared/ui/primitives/View/View';

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type FontWeight = 'light' | 'regular' | 'medium' | 'heavy';
type TransactionType = 'send' | 'receive';

// MonaSans ships ₿ (U+20BF) as a proper glyph, so we can render the Bitcoin
// sign inline with the digits instead of compositing a separate SVG icon.
// Keys are PostScript names — they must match entries registered in
// useFonts.ts, so UIFont(name:) on iOS and the RN font resolver on Android
// both find the face without an alias map.
//
// Exported so other amount displays (e.g. the fiat raw-input view) can lock
// onto the same font metrics. Without this, toggling between display paths
// shifts the rendered height because each font has its own intrinsic
// line-box.
export const AMOUNT_FONT_FAMILY: Record<FontWeight, string> = {
  light: 'MonaSans-Light',
  regular: 'MonaSans-Regular',
  medium: 'MonaSans-Medium',
  heavy: 'MonaSans-Black',
};

interface AmountFormatterProps {
  amount: AmountValue;
  unit: CurrencyUnit;
  size?: number;
  lineHeight?: number;
  weight?: FontWeight;
  /**
   * Text color (non-liquid) / glass tint (liquid).
   * Pass `null` on the liquid path to suppress the tint and show Apple's
   * default glass material.
   */
  color?: string | null;
  style?: StyleProp<ViewStyle>;
  centered?: boolean;
  className?: string;
  animated?: boolean;
  useTypeColors?: boolean;
  transactionType?: TransactionType;
  /**
   * Opt in to Liquid Glass on iOS 26+. Silently falls through to the plain
   * MonaSans text path on older iOS and on Android.
   */
  liquid?: boolean;
  /** `regular` = frosted, `clear` = fully transparent. Only used when liquid. */
  glassVariant?: GlassVariant;
  /**
   * Prepends a direction glyph to the amount, rendered inside the same text
   * node so it shares font metrics, color, and (when enabled) the Liquid
   * Glass surface. Pass `null`/omit for unsigned amounts. The primitive
   * does not infer a sign from the numeric value — the caller owns direction
   * semantics (send/receive) and passes an unsigned `amount`.
   */
  sign?: '+' | '-' | null;
}

/**
 * Displays a formatted monetary amount in MonaSans with a unit glyph chosen
 * from the user's display preference (₿ prefix, ⚡ suffix, or " sats" suffix).
 *
 * The `liquid` prop opts in to the native iOS 26 glass surface. When glass
 * isn't available, the component renders a plain <Text> with the same font,
 * so callers never have to branch on the platform.
 */
export function AmountFormatter({
  amount,
  unit,
  size = 42,
  lineHeight,
  weight = 'heavy',
  color,
  style,
  centered = false,
  className,
  animated = false,
  useTypeColors = false,
  transactionType = 'send',
  liquid = false,
  glassVariant = 'regular',
  sign,
}: AmountFormatterProps) {
  const [foreground, danger, receiveColor] = useThemeColor([
    'foreground',
    'danger',
    'success',
  ] as const);
  const displayBtc = useSettingsStore((state) => state.getDisplayBtc());
  const numericAmount = amountToNumber(amount);

  const decorated = decorate(
    formatAmount({ amount, unit }, { useUserPreference: true }),
    unit,
    displayBtc
  );
  const text = sign ? `${sign} ${decorated}` : decorated;

  const resolvedColor = resolveColor({
    color,
    useTypeColors,
    amount: numericAmount,
    transactionType,
    foreground,
    danger,
    receiveColor,
  });

  const { liquidGlass } = useCapabilities();
  const useGlass = liquid && liquidGlass;
  const colorScheme = useColorScheme();
  const containerClass = centered ? 'items-center justify-center' : 'flex-row items-center';

  useEffect(() => {
    paymentLog.debug('amount_formatter.render', {
      unit,
      amount: numericAmount,
      formattedLength: decorated.length,
      textLength: text.length,
      displayBtc,
      size,
      weight,
      centered,
      animated,
      useTypeColors,
      transactionType,
      liquid,
      liquidGlass,
      useGlass,
      hasSign: !!sign,
      colorMode: color === null ? 'none' : color ? 'explicit' : 'theme',
    });
  }, [
    animated,
    centered,
    color,
    decorated.length,
    displayBtc,
    liquid,
    liquidGlass,
    numericAmount,
    sign,
    size,
    text.length,
    transactionType,
    unit,
    useGlass,
    useTypeColors,
    weight,
  ]);

  return (
    <Log name="AmountFormatter">
      <View className={cn(containerClass, className)} style={style}>
        <ScaleWrapper animated={animated} text={text}>
          {useGlass ? (
            // Overlay pattern: a transparent RNText drives the Yoga
            // measurement so adjacent inline glass nodes lay out correctly;
            // the visible glass view sits on top via absolute-fill.
            // LiquidGlassText's native intrinsicContentSize doesn't
            // reliably flow to Yoga in horizontal flows, so without the
            // backing text two glass amounts next to each other collapse.
            <View>
              <RNText
                allowFontScaling={false}
                style={[
                  plainTextStyle(size, lineHeight, weight, null, centered),
                  { color: 'transparent' },
                ]}>
                {text}
              </RNText>
              <LiquidGlassText
                text={text}
                fontName={AMOUNT_FONT_FAMILY[weight]}
                fontSize={size}
                fontWeight={weight}
                tint={resolvedColor}
                glassVariant={glassVariant}
                colorScheme={colorScheme}
                style={[
                  StyleSheet.absoluteFill,
                  { alignItems: 'center', justifyContent: 'center' },
                ]}
              />
            </View>
          ) : (
            <RNText
              allowFontScaling={false}
              style={plainTextStyle(size, lineHeight, weight, resolvedColor, centered)}>
              {text}
            </RNText>
          )}
        </ScaleWrapper>
      </View>
    </Log>
  );
}

// Fiat amounts already include their symbol (e.g. "$1,234.56"); only sats
// modes need decoration. Mode 2 is already suffixed by formatAmount.
//
// The ⚡︎ uses U+FE0E (VS15) to request the text-presentation glyph — without
// it, some OSes render the emoji-color variant which doesn't extract to a
// vector path inside the glass surface.
// U+2009 thin space sits ~\u00BD the width of a regular space and reads as the
// natural gap between a currency glyph and the digits it labels. Mirrored in
// FiatAmountDisplay so toggling fiat \u2194 sat keeps the symbol cadence identical.
function decorate(formatted: string, unit: CurrencyUnit, displayBtc: number): string {
  if (unit !== 'sat') return formatted;
  if (displayBtc === 0 || displayBtc === 3) return `\u20BF\u2009${formatted}`;
  if (displayBtc === 1) return `${formatted}\u2009\u26A1\uFE0E`;
  return formatted;
}

function plainTextStyle(
  size: number,
  lineHeight: number | undefined,
  weight: FontWeight,
  color: string | null,
  centered: boolean
): TextStyle {
  return {
    fontFamily: AMOUNT_FONT_FAMILY[weight],
    fontSize: size,
    lineHeight,
    // The plain path has no glass surface, so a null tint collapses to the
    // theme foreground — `RNText` can't render `color: null`.
    color: color ?? undefined,
    textAlign: centered ? 'center' : 'left',
    margin: 0,
  };
}

function resolveColor({
  color,
  useTypeColors,
  amount,
  transactionType,
  foreground,
  danger,
  receiveColor,
}: {
  color: string | null | undefined;
  useTypeColors: boolean;
  amount: number;
  transactionType: TransactionType;
  foreground: string;
  danger: string;
  receiveColor: string;
}): string | null {
  // `color === null` is an explicit opt-out: "no tint at all" on the liquid
  // path. Must be checked before the `||` fallback, or null would coerce
  // back to foreground.
  if (color === null) return null;
  if (color) return color;
  if (useTypeColors) {
    if (!amount) return opacity(foreground, 0.4);
    return transactionType === 'receive' ? receiveColor : danger;
  }
  return foreground;
}

// Shrinks long amounts to fit. Mirrors the pre-existing behaviour: strings
// over 6 chars scale down by 5% per extra char. The scale target is derived
// from the formatted text length so it updates as the balance grows.
function ScaleWrapper({
  animated,
  text,
  children,
}: {
  animated: boolean;
  text: string;
  children: React.ReactNode;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animated) return;
    const target = text.length > 6 ? 1 - (text.length - 6) * 0.05 : 1;
    paymentLog.debug('amount_formatter.scale', {
      textLength: text.length,
      target,
      animated,
    });
    Animated.timing(scaleAnim, { toValue: target, duration: 300, useNativeDriver: true }).start();
  }, [animated, text, scaleAnim]);

  if (!animated) return <>{children}</>;
  return <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>{children}</Animated.View>;
}
