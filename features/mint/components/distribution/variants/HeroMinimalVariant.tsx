import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { extractDomain } from '@/shared/lib/url';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { MintSliderControls } from '../MintSliderControls';
import { useDistributionRow } from '../useDistributionRow';
import type { DistributionVariantComponent } from './types';

/**
 * A large "total to split" hero (derived from the balances the screen already
 * has) over a minimal breakdown. Each row is tap-to-edit to keep the chrome calm.
 */
export const HeroMinimalVariant: DistributionVariantComponent = ({
  mintUrls,
  mintInfoMap,
  distribution,
  balanceTotals,
  unit,
  onDistributionChange,
  onMax,
  onMin,
}) => {
  const [muted, separator] = useThemeColor(['muted', 'separator'] as const);
  const [expandedMintUrl, setExpandedMintUrl] = useState<string | null>(null);

  const total = useMemo(
    () => mintUrls.reduce((sum, url) => sum + (balanceTotals[url] ?? 0), 0),
    [mintUrls, balanceTotals]
  );

  return (
    <View>
      <VStack align="center" gap={2} className="mb-5 mt-3 px-4">
        <AmountFormatter amount={total} unit={unit} size={40} weight="heavy" centered />
        <Text size={13} style={{ color: muted }}>
          total to split
        </Text>
      </VStack>

      <View className="mx-4">
        {mintUrls.map((mintUrl, index) => (
          <HeroRow
            key={mintUrl}
            mintUrl={mintUrl}
            mintInfo={mintInfoMap[mintUrl]}
            distributionBp={distribution[mintUrl] || 0}
            showSeparator={index > 0}
            separatorColor={separator}
            isExpanded={expandedMintUrl === mintUrl}
            onToggle={() => setExpandedMintUrl((prev) => (prev === mintUrl ? null : mintUrl))}
            onDistributionChange={onDistributionChange}
            onMax={onMax}
            onMin={onMin}
          />
        ))}
      </View>
    </View>
  );
};

function HeroRow({
  mintUrl,
  mintInfo,
  distributionBp,
  showSeparator,
  separatorColor,
  isExpanded,
  onToggle,
  onDistributionChange,
  onMax,
  onMin,
}: {
  mintUrl: string;
  mintInfo: GetInfoResponse | null | undefined;
  distributionBp: number;
  showSeparator: boolean;
  separatorColor: string;
  isExpanded: boolean;
  onToggle: () => void;
  onDistributionChange: (mintUrl: string, bp: number) => void;
  onMax: (mintUrl: string) => void;
  onMin: (mintUrl: string) => void;
}) {
  const row = useDistributionRow({ mintUrl, mintInfo, distributionBp, onDistributionChange });
  const displayName = mintInfo?.name || extractDomain(mintUrl) || 'Unknown Mint';

  return (
    <View>
      {showSeparator && <View style={{ height: 1, backgroundColor: separatorColor }} />}
      <Pressable
        onPress={onToggle}
        haptics
        accessibilityRole="button"
        accessibilityLabel={`${displayName}, ${row.percentDisplay} percent. Tap to edit.`}
        className="py-3.5">
        <HStack align="center" justify="space-between">
          <HStack align="center" gap={12} flex={1} className="mr-3">
            <View
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: row.accentColor }}
            />
            <Text size={15} numberOfLines={1} className="flex-1">
              {displayName}
            </Text>
          </HStack>
          <Text overpass heavy size={16}>
            {row.percentDisplay}%
          </Text>
        </HStack>
      </Pressable>
      {isExpanded && (
        <View className="pb-3">
          <MintSliderControls mintUrl={mintUrl} row={row} onMax={onMax} onMin={onMin} />
        </View>
      )}
    </View>
  );
}
