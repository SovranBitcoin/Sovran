import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { MintShareRow } from '../MintShareRow';
import type { DistributionVariantComponent } from './types';

/**
 * One calm focal figure — the total being split — over the same bare slider
 * list. The number is the only thing added; everything else is the list.
 */
export const TotalLedVariant: DistributionVariantComponent = ({
  mintUrls,
  mintInfoMap,
  distribution,
  balanceTotals,
  unit,
  onDistributionChange,
}) => {
  const [muted] = useThemeColor(['muted'] as const);
  const total = useMemo(
    () => mintUrls.reduce((sum, url) => sum + (balanceTotals[url] ?? 0), 0),
    [mintUrls, balanceTotals]
  );

  return (
    <View>
      <VStack align="center" gap={2} className="mb-6 mt-4">
        <AmountFormatter amount={total} unit={unit} size={40} weight="heavy" centered />
        <Text size={13} style={{ color: muted }}>
          to split
        </Text>
      </VStack>
      {mintUrls.map((mintUrl) => (
        <MintShareRow
          key={mintUrl}
          mintUrl={mintUrl}
          mintInfo={mintInfoMap[mintUrl]}
          distributionBp={distribution[mintUrl] || 0}
          onDistributionChange={onDistributionChange}
        />
      ))}
    </View>
  );
};
