import React from 'react';
import { View } from 'react-native';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { extractDomain } from '@/shared/lib/url';
import { bpToPercent } from '@/shared/stores/profile/mintDistributionStore';
import { DistributionSlider } from './DistributionSlider';
import { useDistributionRow } from './useDistributionRow';

interface MintShareRowProps {
  mintUrl: string;
  mintInfo: GetInfoResponse | null | undefined;
  distributionBp: number;
  onDistributionChange: (mintUrl: string, bp: number) => void;
}

/**
 * The one editable element every Balance-split variant is built from: a mint's
 * identity, its share %, and a slider — nothing else. No card, no balance line,
 * no Min/Max buttons (drag covers 0–100%). The % is the loud element; the name
 * is muted. Always rendered for every mint (a mint at 0% never disappears).
 */
export function MintShareRow({
  mintUrl,
  mintInfo,
  distributionBp,
  onDistributionChange,
}: MintShareRowProps) {
  const [muted] = useThemeColor(['muted'] as const);
  const row = useDistributionRow({ mintUrl, mintInfo, distributionBp, onDistributionChange });
  const displayName = mintInfo?.name || extractDomain(mintUrl) || 'Unknown Mint';

  return (
    <View className="px-4 py-3">
      <HStack align="center" justify="space-between" className="mb-2">
        <HStack align="center" gap={10} flex={1} className="mr-3">
          <MintIcon
            iconUrl={mintInfo?.icon_url}
            size={28}
            name={displayName}
            alt={`${displayName} icon`}
          />
          <Text size={14} numberOfLines={1} className="flex-1" style={{ color: muted }}>
            {displayName}
          </Text>
        </HStack>
        <Text overpass heavy size={20}>
          {bpToPercent(row.displayBp)}%
        </Text>
      </HStack>
      <View className="min-h-[40px]" onLayout={row.onSliderLayout}>
        {row.sliderWidth > 0 && (
          <DistributionSlider
            value={row.sliderValue}
            onValueChange={row.handleSliderChange}
            onValueCommit={row.handleSliderCommit}
            width={row.sliderWidth}
            customGradientColors={row.sliderColors.gradientColors}
            customBorderColor={row.sliderColors.borderColor}
            isLoadingColors={row.sliderColors.isLoading}
          />
        )}
      </View>
    </View>
  );
}
