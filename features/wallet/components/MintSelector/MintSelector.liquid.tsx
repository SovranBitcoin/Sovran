import React from 'react';
import { View } from 'react-native';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { buttonStyle, frame } from '@expo/ui/swift-ui/modifiers';

import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
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
  const { buttonWidth, contentHeight } = dimensions;
  const h = HEADER_LAYOUT.BUTTON_HEIGHT;

  const buttonModifiers = [
    buttonStyle('glass'),
    frame({
      height: h,
      width: buttonWidth,
      alignment: 'center',
    }),
  ];

  return (
    <View
      style={{
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        width: buttonWidth,
        height: h,
      }}>
      <Host style={{ zIndex: 10, height: h, width: buttonWidth }} matchContents>
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
