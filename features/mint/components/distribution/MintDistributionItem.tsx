import React, { FC, useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import opacity from 'hex-color-opacity';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import Icon from 'assets/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { DistributionSlider } from './DistributionSlider';
import { hexToRgb, useExtractedColors } from './colorUtils';
import { bpToPercent, TOTAL_BASIS_POINTS } from '@/shared/stores/profile/mintDistributionStore';
import { extractDomain } from '@/shared/lib/url';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

interface MintInfo {
  name?: string;
  icon_url?: string;
}

function hexToRgba(hex: string, alpha: number): string | null {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return null;
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface MintDistributionItemProps {
  mintUrl: string;
  mintInfo?: MintInfo | null;
  balance: number;
  unit: string;
  distributionBp: number;
  onDistributionChange: (mintUrl: string, bp: number) => void;
  onMax: (mintUrl: string) => void;
  onMin: (mintUrl: string) => void;
  disabled?: boolean;
}

export const MintDistributionItem: FC<MintDistributionItemProps> = ({
  mintUrl,
  mintInfo,
  balance,
  unit,
  distributionBp,
  onDistributionChange,
  onMax,
  onMin,
  disabled = false,
}) => {
  const [foreground, defaultColor, surfaceTertiary, surfaceSecondary] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'surface-secondary',
  ] as const);
  const primaryColor0 = foreground;
  const primaryColor50 = useMemo(() => opacity(foreground, 0.9), [foreground]);
  const primaryColor300 = useMemo(() => opacity(foreground, 0.5), [foreground]);

  const extractedColors = useExtractedColors(mintInfo?.icon_url);

  const sliderColors = useMemo(() => {
    if (extractedColors.isLoading || !extractedColors.hasExtractedColors) {
      return {
        gradientColors: [defaultColor, surfaceTertiary] as const,
        borderColor: surfaceTertiary,
        isLoading: extractedColors.isLoading,
      };
    }
    return extractedColors;
  }, [extractedColors, defaultColor, surfaceTertiary]);

  const accent = useMemo(() => {
    if (extractedColors.isLoading || !extractedColors.hasExtractedColors) return null;
    return {
      base: extractedColors.baseColor,
      max: extractedColors.gradientColors[0],
      min: extractedColors.gradientColors[1],
      border: extractedColors.borderColor,
    };
  }, [extractedColors]);

  const cardTint = useMemo(() => {
    if (!accent) return null;
    return {
      overlay: hexToRgba(accent.base, 0.1),
      border: hexToRgba(accent.border, 0.25) || hexToRgba(accent.base, 0.25),
    };
  }, [accent]);

  const onAccentSubtleText = accent ? 'rgba(255,255,255,0.7)' : primaryColor300;

  const buttonTint = useMemo(() => {
    if (!accent) return null;
    return {
      background: hexToRgba(accent.base, 0.12),
      border: hexToRgba(accent.border, 0.22) || hexToRgba(accent.base, 0.22),
      icon: hexToRgba(accent.base, 0.9),
    };
  }, [accent]);

  const sliderValue = useSharedValue(distributionBp);

  // Preview state for smooth percentage display during drag without store updates
  const [previewBp, setPreviewBp] = useState<number | null>(null);
  const [sliderWidth, setSliderWidth] = useState(0);

  const handleSliderLayout = useCallback((event: LayoutChangeEvent) => {
    setSliderWidth(event.nativeEvent.layout.width);
  }, []);

  // Sync slider shared value when prop changes (only when not previewing)
  React.useEffect(() => {
    if (previewBp === null) {
      sliderValue.value = distributionBp;
    }
  }, [distributionBp, sliderValue, previewBp]);

  const handleSliderChange = useCallback((bp: number) => {
    setPreviewBp(bp);
  }, []);

  const handleSliderCommit = useCallback(
    (bp: number) => {
      setPreviewBp(null);
      onDistributionChange(mintUrl, bp);
    },
    [mintUrl, onDistributionChange]
  );

  const handleMax = useCallback(() => {
    onMax(mintUrl);
  }, [mintUrl, onMax]);

  const handleMin = useCallback(() => {
    onMin(mintUrl);
  }, [mintUrl, onMin]);

  const displayName = mintInfo?.name || extractDomain(mintUrl) || 'Unknown Mint';

  // Use preview value during drag, otherwise store value
  const displayBp = previewBp ?? distributionBp;
  const percentDisplay = bpToPercent(displayBp);

  // Based on store value, not preview
  const isAtMax = distributionBp === TOTAL_BASIS_POINTS;
  const isAtMin = distributionBp === 0;

  return (
    <Log name="MintDistributionItem">
      <View
        className="mx-4 my-1.5 overflow-hidden rounded-2xl border p-4"
        style={{
          backgroundColor: surfaceSecondary,
          borderColor: cardTint?.border || 'rgba(255,255,255,0.05)',
        }}>
      {/* Per-mint accent lighting derived from icon colors */}
      {!!accent?.base && (
        <>
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: hexToRgba(accent.base, 0.05) || 'transparent' },
            ]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[hexToRgba(accent.max, 0.28) || 'transparent', 'transparent']}
            locations={[0, 0.8]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[
              hexToRgba(accent.min, 0.2) || 'transparent',
              'transparent',
              hexToRgba(accent.max, 0.18) || 'transparent',
            ]}
            locations={[0, 0.55, 1]}
            start={{ x: 1, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.06)', 'transparent']}
            locations={[0, 0.7]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}
      {/* Subtle per-mint tint overlay */}
      {!!cardTint?.overlay && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: cardTint.overlay, borderRadius: 16 }]}
        />
      )}

      <HStack align="center" justify="space-between" className="mb-3">
        <HStack align="center" gap={12} className="mr-3 flex-1">
          <Avatar
            picture={mintInfo?.icon_url}
            size={40}
            name={displayName}
            alt={`${displayName} icon`}
          />
          <VStack gap={2} className="flex-1">
            <Text bold size={14} style={{ color: primaryColor0 }} numberOfLines={1}>
              {displayName}
            </Text>
            <AmountFormatter
              amount={balance}
              unit={unit}
              size={12}
              weight="medium"
              color={onAccentSubtleText}
            />
          </VStack>
        </HStack>

        <Text
          overpass
          heavy
          size={24}
          style={{ color: primaryColor0, minWidth: 60, textAlign: 'right' }}>
          {percentDisplay}%
        </Text>
      </HStack>

      <View className="mb-3 min-h-[40px]" onLayout={handleSliderLayout}>
        {sliderWidth > 0 && (
          <DistributionSlider
            value={sliderValue}
            onValueChange={handleSliderChange}
            onValueCommit={handleSliderCommit}
            disabled={disabled}
            width={sliderWidth}
            customGradientColors={sliderColors.gradientColors}
            customBorderColor={sliderColors.borderColor}
            isLoadingColors={sliderColors.isLoading}
          />
        )}
      </View>

      <HStack gap={8} className="justify-start">
        <TouchableOpacity
          onPress={handleMax}
          disabled={disabled || isAtMax}
          haptics
          className="flex-1 rounded-[14px] border px-3.5 py-3"
          style={{
            backgroundColor: buttonTint?.background || 'rgba(255,255,255,0.06)',
            borderColor: buttonTint?.border || 'rgba(255,255,255,0.10)',
            opacity: disabled || isAtMax ? 0.5 : 1,
          }}>
          <HStack align="center" gap={8}>
            <Icon
              name="mdi:arrow-collapse-up"
              size={16}
              color={buttonTint?.icon || primaryColor50}
            />
            <Text size={12} heavy style={{ color: primaryColor50 }}>
              Max
            </Text>
          </HStack>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleMin}
          disabled={disabled || isAtMin}
          haptics
          className="flex-1 rounded-[14px] border px-3.5 py-3"
          style={{
            backgroundColor: buttonTint?.background || 'rgba(255,255,255,0.06)',
            borderColor: buttonTint?.border || 'rgba(255,255,255,0.10)',
            opacity: disabled || isAtMin ? 0.5 : 1,
          }}>
          <HStack align="center" gap={8}>
            <Icon
              name="mdi:arrow-collapse-down"
              size={16}
              color={buttonTint?.icon || primaryColor50}
            />
            <Text size={12} heavy style={{ color: primaryColor50 }}>
              Min
            </Text>
          </HStack>
        </TouchableOpacity>
        </HStack>
      </View>
    </Log>
  );
};
