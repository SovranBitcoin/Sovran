import React from 'react';
import { View } from 'react-native';
import { MintShareRow } from '../MintShareRow';
import type { DistributionVariantComponent } from './types';

/**
 * The most subtracted layout: a bare list of slider rows, nothing wrapping them.
 * The slider fills and the % values carry everything.
 */
export const MinimalListVariant: DistributionVariantComponent = ({
  mintUrls,
  mintInfoMap,
  distribution,
  onDistributionChange,
}) => {
  return (
    <View className="mt-2">
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
