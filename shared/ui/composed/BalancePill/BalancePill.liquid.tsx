import React from 'react';
import { View } from 'react-native';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { buttonStyle, frame } from '@expo/ui/swift-ui/modifiers';

import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import BalanceDisplay from './BalanceDisplay';
import type { BalancePillProps } from './BalancePill.types';
import { useBalancePillDimensions } from './useBalancePillDimensions';
import { zIndex } from '@/shared/styles/tokens';

/**
 * Liquid-glass variant — wraps `<BalanceDisplay />` in a SwiftUI
 * `buttonStyle('glass')` `Host`. Mirrors `MintSelectorLiquid` so the wallet
 * tab and the AI tab render byte-identical chrome; only the props differ.
 */
export default function BalancePillLiquid({
  onPress,
  width,
  contentWidth: contentWidthOverride,
  contentHeight: contentHeightOverride,
  ...display
}: BalancePillProps): React.ReactElement {
  const dimensions = useBalancePillDimensions({
    width,
    contentWidth: contentWidthOverride,
    contentHeight: contentHeightOverride,
  });
  const h = HEADER_LAYOUT.BUTTON_HEIGHT;

  const buttonModifiers = [
    buttonStyle('glass'),
    frame({
      height: h,
      width: dimensions.buttonWidth,
      alignment: 'center',
    }),
  ];

  return (
    <View
      style={{
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        width: dimensions.buttonWidth,
        height: h,
      }}>
      <Host
        style={{ zIndex: zIndex.sticky, height: h, width: dimensions.buttonWidth }}
        matchContents>
        <SwiftUIButton modifiers={buttonModifiers} onPress={onPress}>
          <BalanceDisplay
            {...display}
            contentWidth={dimensions.contentWidth}
            contentHeight={dimensions.contentHeight}
          />
        </SwiftUIButton>
      </Host>
    </View>
  );
}
