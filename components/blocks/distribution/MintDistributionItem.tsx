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
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import Icon from 'assets/icons';
import { DistributionSlider } from './DistributionSlider';
import { useExtractedColors } from './colorUtils';
import { bpToPercent, TOTAL_BASIS_POINTS } from 'stores/mintDistributionStore';
import { extractDomain } from '@/helper/url';

interface MintInfo {
  name?: string;
  icon_url?: string;
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
  const primaryColor300 = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
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
    <View style={[styles.container, { backgroundColor: primaryColor800 }]}>
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
              color={primaryColor300}
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
            styles.actionButton,
            {
              backgroundColor: primaryColor700,
              opacity: disabled || isAtMax ? 0.5 : 1,
            },
          ]}>
          <HStack align="center" gap={4}>
            <Icon name="mdi:arrow-collapse-up" size={14} color={primaryColor0} />
            <Text bold overpass size={12} style={{ color: primaryColor0 }}>
              Max
            </Text>
          </HStack>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleMin}
          disabled={disabled || isAtMin}
          haptics
          style={[
            styles.actionButton,
            {
              backgroundColor: primaryColor700,
              opacity: disabled || isAtMin ? 0.5 : 1,
            },
          ]}>
          <HStack align="center" gap={4}>
            <Icon name="mdi:arrow-collapse-down" size={14} color={primaryColor0} />
            <Text bold overpass size={12} style={{ color: primaryColor0 }}>
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
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
});

export default MintDistributionItem;
