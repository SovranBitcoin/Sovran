import React from 'react';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { buttonStyle, frame } from '@expo/ui/swift-ui/modifiers';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { View } from '@/shared/ui/primitives/View/View';
import type { MintSelectorShared } from './useMintSelector';

export function MintSelectorLiquid({
  mintName,
  mintIconUrl,
  balance,
  isLoading,
  unit,
  onRequestMintList,
  dimensions,
}: MintSelectorShared): React.ReactElement {
  const buttonModifiers = [
    buttonStyle('glass'),
    frame({ height: 50, width: dimensions.buttonWidth, alignment: 'center' }),
  ];

  return (
    <View
      style={{
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        width: dimensions.buttonWidth,
      }}>
      <Host style={{ zIndex: 10, height: 50, width: dimensions.buttonWidth }} matchContents>
        <SwiftUIButton modifiers={buttonModifiers} onPress={onRequestMintList}>
          <MintBalanceDisplay
            mintName={mintName}
            mintIconUrl={mintIconUrl}
            balance={balance}
            isLoading={isLoading}
            unit={unit}
            contentWidth={dimensions.contentWidth}
            contentHeight={dimensions.contentHeight}
          />
        </SwiftUIButton>
      </Host>
    </View>
  );
}
