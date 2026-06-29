import React from 'react';
import { View } from 'react-native';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { DistributionSlider } from './DistributionSlider';
import type { useDistributionRow } from './useDistributionRow';

interface MintSliderControlsProps {
  mintUrl: string;
  row: ReturnType<typeof useDistributionRow>;
  onMax: (mintUrl: string) => void;
  onMin: (mintUrl: string) => void;
  disabled?: boolean;
}

/**
 * The shared editing controls — slider plus Min/Max — that every variant places
 * around its own row chrome. Keeps the gesture/colour wiring in one place so the
 * variants stay purely presentational.
 */
export function MintSliderControls({
  mintUrl,
  row,
  onMax,
  onMin,
  disabled = false,
}: MintSliderControlsProps) {
  const [foreground, surfaceTertiary, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface-secondary',
  ] as const);
  const buttonBorder = opacity(surfaceTertiary, 0.5);

  return (
    <>
      <View className="mb-3 min-h-[40px]" onLayout={row.onSliderLayout}>
        {row.sliderWidth > 0 && (
          <DistributionSlider
            value={row.sliderValue}
            onValueChange={row.handleSliderChange}
            onValueCommit={row.handleSliderCommit}
            disabled={disabled}
            width={row.sliderWidth}
            customGradientColors={row.sliderColors.gradientColors}
            customBorderColor={row.sliderColors.borderColor}
            isLoadingColors={row.sliderColors.isLoading}
          />
        )}
      </View>

      <HStack gap={8} className="justify-start">
        <Pressable
          onPress={() => onMin(mintUrl)}
          disabled={disabled || row.isAtMin}
          haptics
          accessibilityLabel="Set to minimum"
          className="flex-1 rounded-[14px] border px-3.5 py-3"
          style={{
            backgroundColor: surfaceSecondary,
            borderColor: buttonBorder,
            opacity: disabled || row.isAtMin ? 0.5 : 1,
          }}>
          <HStack align="center" gap={8}>
            <Icon name="mdi:arrow-collapse-down" size={16} color={foreground} />
            <Text size={12} heavy style={{ color: foreground }}>
              Min
            </Text>
          </HStack>
        </Pressable>

        <Pressable
          onPress={() => onMax(mintUrl)}
          disabled={disabled || row.isAtMax}
          haptics
          accessibilityLabel="Set to maximum"
          className="flex-1 rounded-[14px] border px-3.5 py-3"
          style={{
            backgroundColor: surfaceSecondary,
            borderColor: buttonBorder,
            opacity: disabled || row.isAtMax ? 0.5 : 1,
          }}>
          <HStack align="center" gap={8}>
            <Icon name="mdi:arrow-collapse-up" size={16} color={foreground} />
            <Text size={12} heavy style={{ color: foreground }}>
              Max
            </Text>
          </HStack>
        </Pressable>
      </HStack>
    </>
  );
}
