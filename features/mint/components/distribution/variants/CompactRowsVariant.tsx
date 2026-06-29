import React from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { extractDomain } from '@/shared/lib/url';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { DistributionBar } from '../DistributionBar';
import { MintSliderControls } from '../MintSliderControls';
import { useDistributionRow } from '../useDistributionRow';
import type { DistributionVariantComponent } from './types';

/**
 * Dense ranked rows with a proportion bar on top and an always-visible slider
 * per mint — the highest information density of the three variants.
 */
export const CompactRowsVariant: DistributionVariantComponent = ({
  mintUrls,
  mintInfoMap,
  distribution,
  balanceTotals,
  unit,
  onDistributionChange,
  onMax,
  onMin,
}) => {
  return (
    <View>
      <View className="mt-1">
        <DistributionBar
          distribution={distribution}
          mintInfoMap={mintInfoMap}
          mintUrls={mintUrls}
        />
      </View>
      <VStack gap={0}>
        {mintUrls.map((mintUrl) => (
          <CompactRow
            key={mintUrl}
            mintUrl={mintUrl}
            mintInfo={mintInfoMap[mintUrl]}
            balance={balanceTotals[mintUrl] ?? 0}
            unit={unit}
            distributionBp={distribution[mintUrl] || 0}
            onDistributionChange={onDistributionChange}
            onMax={onMax}
            onMin={onMin}
          />
        ))}
      </VStack>
    </View>
  );
};

function CompactRow({
  mintUrl,
  mintInfo,
  balance,
  unit,
  distributionBp,
  onDistributionChange,
  onMax,
  onMin,
}: {
  mintUrl: string;
  mintInfo: GetInfoResponse | null | undefined;
  balance: number;
  unit: string;
  distributionBp: number;
  onDistributionChange: (mintUrl: string, bp: number) => void;
  onMax: (mintUrl: string) => void;
  onMin: (mintUrl: string) => void;
}) {
  const [surfaceSecondary] = useThemeColor(['surface-secondary'] as const);
  const row = useDistributionRow({ mintUrl, mintInfo, distributionBp, onDistributionChange });
  const displayName = mintInfo?.name || extractDomain(mintUrl) || 'Unknown Mint';

  return (
    <View className="mx-4 my-1 rounded-2xl p-4" style={{ backgroundColor: surfaceSecondary }}>
      <HStack align="center" justify="space-between" className="mb-3">
        <HStack align="center" gap={12} className="mr-3 flex-1">
          <MintIcon
            iconUrl={mintInfo?.icon_url}
            size={36}
            name={displayName}
            alt={`${displayName} icon`}
          />
          <VStack gap={2} className="flex-1">
            <Text bold size={14} numberOfLines={1}>
              {displayName}
            </Text>
            <AmountFormatter amount={balance} unit={unit} size={12} weight="medium" />
          </VStack>
        </HStack>
        <Text overpass heavy size={22} style={{ minWidth: 54, textAlign: 'right' }}>
          {row.percentDisplay}%
        </Text>
      </HStack>
      <MintSliderControls mintUrl={mintUrl} row={row} onMax={onMax} onMin={onMin} />
    </View>
  );
}
