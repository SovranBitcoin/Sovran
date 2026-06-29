import React, { useCallback, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useExtractedColors } from '@/shared/lib/colorExtraction';
import { bpToPercent, TOTAL_BASIS_POINTS } from '@/shared/stores/profile/mintDistributionStore';

interface MintInfoLike {
  name?: string;
  icon_url?: string;
}

interface UseDistributionRowArgs {
  mintUrl: string;
  mintInfo?: MintInfoLike | null;
  distributionBp: number;
  onDistributionChange: (mintUrl: string, bp: number) => void;
}

/**
 * Shared per-mint editing seam for every Balance-split variant. Owns the
 * slider's shared value, the during-drag preview state, measured width, and the
 * icon-derived colors — so each variant only has to lay out the chrome around
 * `<DistributionSlider>` without re-implementing the gesture wiring. Preview
 * state is local to the row, so switching variants (which unmounts the rows)
 * leaves no residual state behind.
 */
export function useDistributionRow({
  mintUrl,
  mintInfo,
  distributionBp,
  onDistributionChange,
}: UseDistributionRowArgs) {
  const [defaultColor, surfaceTertiary] = useThemeColor(['default', 'surface-tertiary'] as const);

  const extractedColors = useExtractedColors(mintInfo?.icon_url);

  const sliderColors = useMemo(() => {
    if (extractedColors.isLoading || !extractedColors.hasExtractedColors) {
      return {
        gradientColors: [defaultColor, surfaceTertiary] as const,
        borderColor: surfaceTertiary,
        isLoading: extractedColors.isLoading,
      };
    }
    return {
      gradientColors: extractedColors.gradientColors,
      borderColor: extractedColors.borderColor,
      isLoading: false,
    };
  }, [extractedColors, defaultColor, surfaceTertiary]);

  // Stable, legible accent for dots/legend/donut segments.
  const accentColor = useMemo(() => {
    if (extractedColors.isLoading || !extractedColors.hasExtractedColors) return defaultColor;
    return extractedColors.gradientColors?.[0] || extractedColors.baseColor || defaultColor;
  }, [extractedColors, defaultColor]);

  const sliderValue = useSharedValue(distributionBp);
  const [previewBp, setPreviewBp] = useState<number | null>(null);
  const [sliderWidth, setSliderWidth] = useState(0);

  const onSliderLayout = useCallback((event: LayoutChangeEvent) => {
    setSliderWidth(event.nativeEvent.layout.width);
  }, []);

  // Keep the slider in sync with the store value unless the user is dragging.
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

  const displayBp = previewBp ?? distributionBp;

  return {
    sliderValue,
    sliderWidth,
    onSliderLayout,
    handleSliderChange,
    handleSliderCommit,
    sliderColors,
    accentColor,
    displayBp,
    percentDisplay: bpToPercent(displayBp),
    isAtMax: distributionBp === TOTAL_BASIS_POINTS,
    isAtMin: distributionBp === 0,
  };
}
