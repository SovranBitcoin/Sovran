import React from 'react';
import { View } from 'react-native';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { buttonStyle, frame } from '@expo/ui/swift-ui/modifiers';

import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { Log } from '@/shared/lib/logger';
import BalanceDisplay, { type BalanceDisplayProps } from './BalanceDisplay';

interface BalancePillLiquidProps extends BalanceDisplayProps {
  buttonWidth: number;
  onPress?: () => void;
}

/**
 * Liquid-glass variant — wraps `<BalanceDisplay />` in a SwiftUI
 * `buttonStyle('glass')` `Host`. Mirrors `MintSelectorLiquid` so the wallet
 * tab and the AI tab render byte-identical chrome; only the props differ.
 */
export function BalancePillLiquid({
  buttonWidth,
  onPress,
  ...display
}: BalancePillLiquidProps): React.ReactElement {
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
    <Log name="BalancePillLiquid">
      <View
        style={{
          alignSelf: 'center',
          alignItems: 'center',
          justifyContent: 'center',
          width: buttonWidth,
          height: h,
        }}>
        <Host style={{ zIndex: 10, height: h, width: buttonWidth }} matchContents>
          <SwiftUIButton modifiers={buttonModifiers} onPress={onPress}>
            <BalanceDisplay {...display} />
          </SwiftUIButton>
        </Host>
      </View>
    </Log>
  );
}
