import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, Text as RNText, TextStyle, ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { LiquidGlassText } from 'liquid-glass-text';
import type { GlassVariant } from 'liquid-glass-text';

import { formatDisplayAmount } from '@/shared/lib/amountDisplay';
import { amountToNumber, type AmountValue } from 'wallet/amount';
import { Log, paymentLog } from '@/shared/lib/logger';
import { cn } from '@/shared/lib/classNames';
import { useCapabilities } from '@/shared/ui/capability';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { RollingAmountText } from '@/shared/ui/composed/RollingAmountText';
import { View } from '@/shared/ui/primitives/View/View';

type FontWeight = 'light' | 'regular' | 'medium' | 'bold' | 'heavy';

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
  light: 'MonaSans-Regular',
  regular: 'MonaSans-Regular',
  medium: 'MonaSans-Medium',
  bold: 'MonaSans-Bold',
  heavy: 'MonaSans-Black',
};

interface AmountFormatterProps {
  amount: AmountValue;
  unit: string;
  /**
   * Explicit BTC/sats display preference. Defaults to the persisted setting;
   * pass a value when the same component must render reproducibly in an
   * exported image, preview, or test fixture.
   */
  displayPreference?: number;
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
  /**
   * Roll the digits that change into place (up on an increase, down on a
   * decrease) instead of swapping the text. Snaps on mount, on a BTC/sats or
   * unit switch, and under reduced motion. Liquid Glass keeps its glyph
   * cutouts and rolls natively on iOS 26+.
   */
  animated?: boolean;
  /** Shrink strings over 6 characters by 5% per extra character. */
  scaleToFit?: boolean;
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
  displayPreference,
  size = 42,
  lineHeight,
  weight = 'heavy',
  color,
  style,
  centered = false,
  className,
  animated = false,
  scaleToFit = false,
  liquid = false,
  glassVariant = 'regular',
  sign,
}: AmountFormatterProps) {
  const foreground = useThemeColor('foreground');
  const storedDisplayPreference = useSettingsStore((state) => state.displayBtc);
  const displayBtc = displayPreference ?? storedDisplayPreference;

  const decorated = formatDisplayAmount(amount, unit, displayBtc);
  const text = sign ? `${sign} ${decorated}` : decorated;
  // What the roll compares to choose a direction, and what makes a change a
  // re-reading (snap) rather than a new value (roll).
  const numericValue = (sign === '-' ? -1 : 1) * amountToNumber(amount);
  const formatKey = `${unit}:${displayBtc}`;

  const resolvedColor = resolveColor({ color, foreground });

  const { liquidGlass } = useCapabilities();
  const useGlass = liquid && liquidGlass;
  const colorScheme = useColorScheme();
  const containerClass = centered ? 'items-center justify-center' : 'flex-row items-center';

  return (
    <Log name="AmountFormatter">
      <View className={cn(containerClass, className)} style={style}>
        <ScaleWrapper enabled={scaleToFit} text={text}>
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
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                // The native roll lays digits out at tabular widths.
                className={animated ? 'tabular-nums' : undefined}
                style={[
                  plainTextStyle(size, lineHeight, weight, null, centered),
                  { color: 'transparent' },
                ]}>
                {text}
              </RNText>
              <LiquidGlassText
                text={text}
                animated={animated}
                numericValue={numericValue}
                formatKey={formatKey}
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
          ) : animated ? (
            <RollingAmountText
              text={text}
              numericValue={numericValue}
              formatKey={formatKey}
              style={plainTextStyle(size, lineHeight, weight, resolvedColor, centered)}
            />
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
  foreground,
}: {
  color: string | null | undefined;
  foreground: string;
}): string | null {
  // `color === null` is an explicit opt-out: "no tint at all" on the liquid
  // path. Must be checked before the `||` fallback, or null would coerce
  // back to foreground.
  if (color === null) return null;
  if (color) return color;
  return foreground;
}

// Shrinks long amounts to fit: strings over 6 chars scale down by 5% per
// extra char. The scale target is derived from the formatted text length so it
// updates as the balance grows.
function ScaleWrapper({
  enabled,
  text,
  children,
}: {
  enabled: boolean;
  text: string;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const target = text.length > 6 ? 1 - (text.length - 6) * 0.05 : 1;

  useEffect(() => {
    if (!enabled) return;
    paymentLog.debug('amount_formatter.scale', { textLength: text.length, target });
    scale.set(withTiming(target, { duration: 300, reduceMotion: ReduceMotion.System }));
  }, [enabled, text.length, target, scale]);

  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  if (!enabled) return <>{children}</>;
  return <Animated.View style={scaleStyle}>{children}</Animated.View>;
}
