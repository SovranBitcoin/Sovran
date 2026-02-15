/**
 * @fileoverview Mint Distribution Item Component
 *
 * Displays a single mint's distribution settings with:
 * - Mint avatar and name
 * - Current balance display
 * - Distribution percentage slider
 * - Max/Min quick action buttons
 */

import React, { FC, useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import Icon from 'assets/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { DistributionSlider } from './DistributionSlider';
import { hexToRgb, useExtractedColors } from './colorUtils';
import { bpToPercent, TOTAL_BASIS_POINTS } from 'stores/mintDistributionStore';
import { extractDomain } from '@/helper/url';

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
  /** Mint URL */
  mintUrl: string;
  /** Mint info (name, icon) */
  mintInfo?: MintInfo | null;
  /** Current balance in the mint */
  balance: number;
  /** Unit for balance display */
  unit: string;
  /** Current distribution in basis points */
  distributionBp: number;
  /** Callback when distribution changes */
  onDistributionChange: (mintUrl: string, bp: number) => void;
  /** Callback for Max button */
  onMax: (mintUrl: string) => void;
  /** Callback for Min button */
  onMin: (mintUrl: string) => void;
  /** Whether controls are disabled */
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
  const { getPrimaryColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor50 = useMemo(() => opacity(getPrimaryColor('0'), 0.9), [getPrimaryColor]);
  const primaryColor300 = useMemo(() => opacity(getPrimaryColor('0'), 0.5), [getPrimaryColor]);
  const primaryColor600 = useMemo(() => getPrimaryColor('600'), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor800 = useMemo(() => getPrimaryColor('800'), [getPrimaryColor]);

  // Extract colors from mint icon for slider styling
  const extractedColors = useExtractedColors(mintInfo?.icon_url);

  // Use theme colors as fallback when loading or no extracted colors
  const sliderColors = useMemo(() => {
    if (extractedColors.isLoading || !extractedColors.hasExtractedColors) {
      return {
        gradientColors: [primaryColor600, primaryColor700] as const,
        borderColor: primaryColor700,
        isLoading: extractedColors.isLoading,
      };
    }
    return extractedColors;
  }, [extractedColors, primaryColor600, primaryColor700]);

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
      // Match the Explore-card feel: accent border is present but subtle.
      border: hexToRgba(accent.border, 0.25) || hexToRgba(accent.base, 0.25),
    };
  }, [accent]);

  const onAccentSubtleText = useMemo(() => {
    // Grey-on-color reads muddy; use "on-accent" white with opacity for secondary text.
    return accent ? 'rgba(255,255,255,0.7)' : primaryColor300;
  }, [accent, primaryColor300]);

  const maxButtonTint = useMemo(() => {
    if (!accent) return null;
    return {
      background: hexToRgba(accent.base, 0.12),
      border: hexToRgba(accent.border, 0.22) || hexToRgba(accent.base, 0.22),
      icon: hexToRgba(accent.base, 0.9),
    };
  }, [accent]);

  const minButtonTint = useMemo(() => {
    if (!accent) return null;
    return {
      background: hexToRgba(accent.base, 0.12),
      border: hexToRgba(accent.border, 0.22) || hexToRgba(accent.base, 0.22),
      icon: hexToRgba(accent.base, 0.9),
    };
  }, [accent]);

  // Shared value for slider
  const sliderValue = useSharedValue(distributionBp);

  // Local preview state for percentage display during drag
  // This allows smooth visual feedback without triggering store updates
  const [previewBp, setPreviewBp] = useState<number | null>(null);

  // Measured slider width from layout
  const [sliderWidth, setSliderWidth] = useState(0);

  // Measure the slider container width on layout
  const handleSliderLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setSliderWidth(width);
  }, []);

  // Sync slider shared value when prop changes (only when not previewing)
  React.useEffect(() => {
    if (previewBp === null) {
      sliderValue.value = distributionBp;
    }
  }, [distributionBp, sliderValue, previewBp]);

  // Handle slider value change during drag (preview only, no store update)
  const handleSliderChange = useCallback((bp: number) => {
    setPreviewBp(bp);
  }, []);

  // Handle slider value commit on gesture end (updates store)
  const handleSliderCommit = useCallback(
    (bp: number) => {
      setPreviewBp(null); // Clear preview
      onDistributionChange(mintUrl, bp);
    },
    [mintUrl, onDistributionChange]
  );

  // Handle Max button press
  const handleMax = useCallback(() => {
    onMax(mintUrl);
  }, [mintUrl, onMax]);

  // Handle Min button press
  const handleMin = useCallback(() => {
    onMin(mintUrl);
  }, [mintUrl, onMin]);

  // Get display name
  const displayName = mintInfo?.name || extractDomain(mintUrl) || 'Unknown Mint';

  // Percentage display - use preview value during drag, otherwise store value
  const displayBp = previewBp !== null ? previewBp : distributionBp;
  const percentDisplay = bpToPercent(displayBp);

  // Check if at max or min (based on store value, not preview)
  const isAtMax = distributionBp === TOTAL_BASIS_POINTS;
  const isAtMin = distributionBp === 0;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: primaryColor800,
          borderColor: cardTint?.border || 'rgba(255,255,255,0.05)',
        },
      ]}>
      {/* Explore-card style “lighting” layers, but derived per-mint from its icon colors. */}
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
      {/* Subtle per-mint tint derived from the icon colors (keeps the base “card” look consistent). */}
      {!!cardTint?.overlay && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: cardTint.overlay, borderRadius: styles.container.borderRadius },
          ]}
        />
      )}
      {/* Header row: Avatar, Name, Balance, Percentage */}
      <HStack align="center" justify="space-between" style={styles.headerRow}>
        <HStack align="center" gap={12} style={styles.mintInfo}>
          <Avatar
            picture={mintInfo?.icon_url}
            size={40}
            variant="mint"
            name={displayName}
            alt={`${displayName} icon`}
          />
          <VStack gap={2} style={styles.nameContainer}>
            <Text bold overpass size={14} style={{ color: primaryColor0 }} numberOfLines={1}>
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
          heavy
          overpass
          size={24}
          style={{ color: primaryColor0, minWidth: 60, textAlign: 'right' }}>
          {percentDisplay}%
        </Text>
      </HStack>

      {/* Slider */}
      <View style={styles.sliderRow} onLayout={handleSliderLayout}>
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

      {/* Quick action buttons */}
      <HStack gap={8} style={styles.buttonRow}>
        <TouchableOpacity
          onPress={handleMax}
          disabled={disabled || isAtMax}
          haptics
          style={[
            styles.ctaButton,
            {
              backgroundColor: maxButtonTint?.background || 'rgba(255,255,255,0.06)',
              borderColor: maxButtonTint?.border || 'rgba(255,255,255,0.10)',
              opacity: disabled || isAtMax ? 0.5 : 1,
            },
          ]}>
          <HStack align="center" gap={8}>
            <Icon
              name="mdi:arrow-collapse-up"
              size={16}
              color={maxButtonTint?.icon || primaryColor50}
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
          style={[
            styles.ctaButton,
            {
              backgroundColor: minButtonTint?.background || 'rgba(255,255,255,0.06)',
              borderColor: minButtonTint?.border || 'rgba(255,255,255,0.10)',
              opacity: disabled || isAtMin ? 0.5 : 1,
            },
          ]}>
          <HStack align="center" gap={8}>
            <Icon
              name="mdi:arrow-collapse-down"
              size={16}
              color={minButtonTint?.icon || primaryColor50}
            />
            <Text size={12} heavy style={{ color: primaryColor50 }}>
              Min
            </Text>
          </HStack>
        </TouchableOpacity>
      </HStack>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    overflow: 'hidden',
    borderWidth: 1,
  },
  headerRow: {
    marginBottom: 12,
  },
  mintInfo: {
    flex: 1,
    marginRight: 12,
  },
  nameContainer: {
    flex: 1,
  },
  sliderRow: {
    marginBottom: 12,
    minHeight: 40, // Reserve space for slider before layout measurement
  },
  buttonRow: {
    justifyContent: 'flex-start',
  },
  ctaButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
