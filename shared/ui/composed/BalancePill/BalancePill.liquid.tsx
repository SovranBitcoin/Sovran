import React from 'react';
import { View } from 'react-native';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { environment, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import BalanceDisplay from './BalanceDisplay';
import type { BalancePillProps } from './BalancePill.types';
import { useBalancePillDimensions } from './useBalancePillDimensions';
import { spacing, zIndex } from '@/shared/styles/tokens';

// Matches `BalancePill.flat`'s `HORIZONTAL_PADDING` — the mint selector,
// fiat/sat swapper, and wallet-header pill should look pixel-aligned across
// liquid / blur / flat so the icon doesn't visibly jump left when the
// device toggles chrome.
const HORIZONTAL_PADDING = spacing.md;

/**
 * Liquid-glass variant — wraps `<BalanceDisplay />` in a SwiftUI button
 * decorated with `glassEffect` (capsule). We deliberately avoid
 * `buttonStyle('glass')` here: that style adds its own intrinsic vertical
 * padding around the label, which fights the explicit `contentHeight` the
 * callers pass and leaves the icon + amount visibly off-center inside the
 * capsule (especially when `contentHeight` matches the outer height, as
 * the currency swapper sets it). Using `glassEffect` after `frame` lets
 * the capsule fill the frame exactly while the inner `BalanceDisplay`
 * handles centering via its `HStack align="center"` — matching the
 * approach `FiatCurrencyPillLiquid` already ships with.
 */
export default function BalancePillLiquid({
  onPress,
  width,
  height,
  contentWidth: contentWidthOverride,
  contentHeight: contentHeightOverride,
  ...display
}: BalancePillProps): React.ReactElement {
  const dimensions = useBalancePillDimensions({
    width,
    contentWidth: contentWidthOverride,
    contentHeight: contentHeightOverride,
  });
  const h = height ?? HEADER_LAYOUT.BUTTON_HEIGHT;
  const colorScheme = useColorScheme();

  const buttonModifiers = [
    environment('colorScheme', colorScheme),
    frame({
      height: h,
      width: dimensions.buttonWidth,
      alignment: 'center',
    }),
    // No tint — the pill should pick up the wallpaper/background through
    // the glass material instead of getting a subtle white wash on top.
    glassEffect({
      shape: 'capsule' as const,
      glass: { variant: 'regular' as const, interactive: true },
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
          {/*
           * RN wrapper owns the layout: a fixed-size box matching the
           * SwiftUI frame, with paddingHorizontal mirroring the flat
           * variant and `justifyContent: 'center'` to vertically center
           * the (potentially shorter) `BalanceDisplay` row inside it.
           * Doing the centering in RN — not relying on SwiftUI's frame
           * alignment — keeps the icon + label visually aligned with the
           * adjacent Next button when `height` > `contentHeight`.
           */}
          <View
            style={{
              width: dimensions.buttonWidth,
              height: h,
              paddingHorizontal: HORIZONTAL_PADDING,
              justifyContent: 'center',
            }}>
            <BalanceDisplay
              {...display}
              contentWidth={Math.max(0, dimensions.buttonWidth - HORIZONTAL_PADDING * 2)}
              contentHeight={dimensions.contentHeight}
            />
          </View>
        </SwiftUIButton>
      </Host>
    </View>
  );
}
