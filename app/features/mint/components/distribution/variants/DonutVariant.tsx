import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { DistributionDonut } from '../DistributionDonut';
import { MintShareRow } from '../MintShareRow';
import type { DistributionVariantComponent } from './types';

/**
 * A quiet proportion donut as the at-a-glance summary, with the same bare slider
 * list below for editing. The donut is a shape, not a data table — the rows carry
 * the labels and values.
 */
export const DonutVariant: DistributionVariantComponent = ({
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
      <View className="my-4 items-center">
        <DistributionDonut
          mintUrls={mintUrls}
          distribution={distribution}
          mintInfoMap={mintInfoMap}
          center={
            <VStack align="center" gap={1}>
              <AmountFormatter amount={total} unit={unit} size={20} weight="heavy" centered />
              <Text size={11} style={{ color: muted }}>
                to split
              </Text>
            </VStack>
          }
        />
      </View>
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
