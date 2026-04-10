import React, { useEffect, useRef } from 'react';
import { StyleProp, ViewStyle, Animated } from 'react-native';

import { BtcIcon, LightningUnit } from 'assets/icons';
import opacity from 'hex-color-opacity';

import { formatAmount } from '@/shared/lib/currency';
import { Log } from '@/shared/lib/logger';
import { cn } from '@/shared/lib/utils';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

import { StyledText, Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type FontWeight = 'heavy' | 'medium' | 'regular' | 'light';
type TransactionType = 'send' | 'receive';

interface AmountFormatterProps {
  amount: number;
  unit: CurrencyUnit;
  size?: number;
  weight?: FontWeight;
  color?: string;
  style?: StyleProp<ViewStyle>;
  animated?: boolean;
  useTypeColors?: boolean;
  transactionType?: TransactionType;
  centered?: boolean;
  className?: string;
}

/**
 * Displays a formatted monetary amount with the appropriate icon/symbol for
 * the user's display preference (BTC, lightning sats, plain sats, or BTC alt).
 *
 * displayBtc modes: 0/3 = ₿ icon prefix, 1 = lightning icon suffix, 2 = text-only "X sats".
 */
export function AmountFormatter({
  amount,
  unit,
  size = 42,
  weight = 'heavy',
  color,
  style,
  animated = false,
  useTypeColors = false,
  transactionType = 'send',
  centered = false,
  className,
}: AmountFormatterProps) {
  const [foreground, danger] = useThemeColor(['foreground', 'danger'] as const);
  const displayBtc = useSettingsStore((state) => state.getDisplayBtc());

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const formattedAmount = formatAmount({ amount, unit }, { useUserPreference: true });

  const currentColor =
    color ||
    (useTypeColors ? getTypeColor(amount, transactionType, foreground, danger) : foreground);
  const textAlign = centered ? ('center' as const) : ('left' as const);
  const containerClass = centered ? 'items-center justify-center' : 'flex-row items-center';

  useEffect(() => {
    if (!animated) return;
    const length = formattedAmount.length;
    const newScale = length > 6 ? 1 - (length - 6) * 0.05 : 1;
    Animated.timing(scaleAnim, { toValue: newScale, duration: 300, useNativeDriver: true }).start();
  }, [animated, formattedAmount, scaleAnim]);

  const textStyle = { color: currentColor, margin: 0, zIndex: 2, textAlign };

  if (unit !== 'sat') {
    return (
      <Log name="AmountFormatter">
        <View className={containerClass} style={style}>
          <ScaleWrapper animated={animated} scaleAnim={scaleAnim}>
            <Text overpass size={size} weight={weight} style={textStyle}>
              {formattedAmount}
            </Text>
          </ScaleWrapper>
        </View>
      </Log>
    );
  }

  const showBtcIcon = displayBtc === 0 || displayBtc === 3;
  const showLightningIcon = displayBtc === 1;
  const TextComponent = displayBtc === 1 ? StyledText : Text;

  const iconMarginLeft = centered ? 0 : Math.round(size * (weight === 'heavy' ? -0.14 : -0.1));
  const textMarginLeft = centered ? 0 : Math.round(size * (weight === 'heavy' ? -0.05 : -0.1));

  return (
    <Log name="AmountFormatter">
      <View className={cn(containerClass, className)} style={style}>
        <ScaleWrapper animated={animated} scaleAnim={scaleAnim}>
          <HStack align="center" style={style}>
            {showBtcIcon && (
              <View style={{ marginLeft: iconMarginLeft, marginRight: centered ? 4 : 0 }}>
                <BtcIcon weight={weight} size={size} color={currentColor} />
              </View>
            )}
            <TextComponent
              overpass
              size={size}
              weight={weight}
              style={{
                ...textStyle,
                ...(showBtcIcon && { marginLeft: textMarginLeft }),
              }}>
              {formattedAmount}
            </TextComponent>
            {showLightningIcon && (
              <View style={{ marginBottom: 4, marginLeft: centered ? 4 : 0 }}>
                <LightningUnit height={size} width={size} color={currentColor} />
              </View>
            )}
          </HStack>
        </ScaleWrapper>
      </View>
    </Log>
  );
}

function getTypeColor(
  amount: number,
  transactionType: TransactionType,
  foreground: string,
  danger: string
): string {
  if (!amount) return opacity(foreground, 0.4);
  return transactionType === 'receive' ? foreground : danger;
}

/**
 * Wraps children in Animated.View when animated, otherwise renders children directly.
 * Defined as a named component so React preserves identity across renders.
 */
function ScaleWrapper({
  animated,
  scaleAnim,
  children,
}: {
  animated: boolean;
  scaleAnim: Animated.Value;
  children: React.ReactNode;
}) {
  if (!animated) return <>{children}</>;
  return <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>{children}</Animated.View>;
}
