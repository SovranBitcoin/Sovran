import React from 'react';
import { View } from 'react-native';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { buttonStyle, frame } from '@expo/ui/swift-ui/modifiers';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import type { MintSelectorShared } from './useMintSelector';

/** MintBalanceDisplay uses padding 8 + inner row + padding 8. */
function liquidButtonHeight(contentHeight: number): number {
  return 16 + contentHeight;
}

export function MintSelectorLiquid({
  mintName,
  mintIconUrl,
  balance,
  isLoading,
  unit,
  onRequestMintList,
  dimensions,
}: MintSelectorShared): React.ReactElement {
  const { buttonWidth, contentHeight } = dimensions;
  const h = liquidButtonHeight(contentHeight);

  const buttonModifiers = [
    buttonStyle('glass'),
    frame({
      height: h,
      width: buttonWidth,
      alignment: 'center',
    }),
  ];

  return (
    <Host style={{ zIndex: 10, height: h, width: buttonWidth }} matchContents={false}>
      <SwiftUIButton modifiers={buttonModifiers} onPress={onRequestMintList}>
        <View
          style={{
            width: buttonWidth,
            height: h,
            justifyContent: 'center',
            alignItems: 'stretch',
          }}>
          <MintBalanceDisplay
            mintName={mintName}
            mintIconUrl={mintIconUrl}
            balance={balance}
            isLoading={isLoading}
            unit={unit}
            contentWidth={dimensions.contentWidth}
            contentHeight={dimensions.contentHeight}
            style={{ width: buttonWidth }}
          />
        </View>
      </SwiftUIButton>
    </Host>
  );
}
