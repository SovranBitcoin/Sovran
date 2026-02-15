import React, { useEffect, useRef } from 'react';
import { StyleProp, ViewStyle, Animated } from 'react-native';
import { StyledText, Text } from 'components/ui/Text';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { formatAmount } from 'helper/currency';
import { BtcIcon, LightningUnit } from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { useSettingsStore } from 'stores/settingsStore';
import { cn } from '@/helper/utils';

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
  // Optional enhancements (defaults preserve existing behavior)
  animated?: boolean;
  useTypeColors?: boolean;
  transactionType?: TransactionType;
  centered?: boolean;
  className?: string;
}

/**
 * Formats and displays monetary amounts with appropriate currency symbols
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
  const { getPrimaryColor, getShadeColor } = useTheme();
  const displayBtc = useSettingsStore((state) => state.getDisplayBtc());

  // Animation setup (only if animated is true)
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const formattedAmount = formatAmount({ amount, unit }, { useUserPreference: true });

  // Dynamic color logic (only if useTypeColors is true)
  const getTypeColor = (): string => {
    if (!amount) return opacity(getPrimaryColor('0'), 0.4);
    // Receive = white, Send = shade color
    return transactionType === 'receive' ? getPrimaryColor('0') : getShadeColor('300');
  };

  // Final color: prioritize passed color, then type colors, then default
  const currentColor = color || (useTypeColors ? getTypeColor() : getPrimaryColor('0'));

  // Animation effect (only if animated is true)
  useEffect(() => {
    if (!animated) return;

    const length = formattedAmount.toString().length;
    const newScale = length > 6 ? 1 - (length - 6) * 0.05 : 1;

    Animated.timing(scaleAnim, {
      toValue: newScale,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [animated, formattedAmount, scaleAnim]);

  // Wrapper component for animation (only when animated is true)
  const AnimatedWrapper = ({ children }: { children: React.ReactNode }) => {
    if (!animated) {
      return <>{children}</>;
    }
    return <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>{children}</Animated.View>;
  };

  // Container styling based on centered prop
  const containerClass = centered ? 'items-center justify-center' : 'flex-row items-center';

  if (unit !== 'sat') {
    return (
      <View className={containerClass} style={style}>
        <AnimatedWrapper>
          <Text
            size={size}
            weight={weight}
            style={{
              color: currentColor,
              margin: 0,
              zIndex: 2,
              textAlign: centered ? 'center' : 'left',
            }}>
            {formattedAmount}
          </Text>
        </AnimatedWrapper>
      </View>
    );
  }

  return (
    <View className={cn(containerClass, className)} style={style}>
      {displayBtc === 0 && (
        <AnimatedWrapper>
          <HStack align="center" style={style}>
            <View
              style={{
                marginLeft: centered ? 0 : Math.round(size * (weight === 'heavy' ? -0.14 : -0.1)),
                marginRight: centered ? 4 : 0,
              }}>
              <BtcIcon weight={weight} size={size} color={currentColor} />
            </View>
            <Text
              size={size}
              weight={weight}
              style={{
                color: currentColor,
                marginLeft: centered ? 0 : Math.round(size * (weight === 'heavy' ? -0.05 : -0.1)),
                margin: 0,
                zIndex: 2,
                textAlign: centered ? 'center' : 'left',
              }}>
              {formattedAmount}
            </Text>
          </HStack>
        </AnimatedWrapper>
      )}

      {displayBtc === 1 && (
        <AnimatedWrapper>
          <HStack align="center" style={style}>
            <StyledText
              size={size}
              weight={weight}
              style={{
                color: currentColor,
                margin: 0,
                zIndex: 2,
                textAlign: centered ? 'center' : 'left',
              }}>
              {formattedAmount}
            </StyledText>
            <View
              style={{
                marginBottom: 4,
                marginLeft: centered ? 4 : 0,
              }}>
              <LightningUnit height={size} width={size} color={currentColor} />
            </View>
          </HStack>
        </AnimatedWrapper>
      )}

      {displayBtc === 2 && (
        <AnimatedWrapper>
          <HStack align="center" style={style}>
            <Text
              size={size}
              weight={weight}
              style={{
                color: currentColor,
                margin: 0,
                zIndex: 2,
                textAlign: centered ? 'center' : 'left',
              }}>
              {formattedAmount}
            </Text>
          </HStack>
        </AnimatedWrapper>
      )}

      {displayBtc === 3 && (
        <AnimatedWrapper>
          <HStack align="center" style={style}>
            <View
              style={{
                marginLeft: centered ? 0 : Math.round(size * (weight === 'heavy' ? -0.14 : -0.1)),
                marginRight: centered ? 4 : 0,
              }}>
              <BtcIcon weight={weight} size={size} color={currentColor} />
            </View>
            <Text
              size={size}
              weight={weight}
              style={{
                color: currentColor,
                marginLeft: centered ? 0 : Math.round(size * (weight === 'heavy' ? -0.05 : -0.1)),
                margin: 0,
                zIndex: 2,
                textAlign: centered ? 'center' : 'left',
              }}>
              {formattedAmount}
            </Text>
          </HStack>
        </AnimatedWrapper>
      )}
    </View>
  );
}
