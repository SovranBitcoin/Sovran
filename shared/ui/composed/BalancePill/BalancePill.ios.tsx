import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import {
  getContentWidthFromButtonWidth,
  getHeaderTitleWidthFromWidth,
  HEADER_LAYOUT,
} from '@/features/wallet/lib/walletHeader';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { View } from '@/shared/ui/primitives/View/View';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { Log } from '@/shared/lib/logger';
import BalanceDisplay, { type BalanceDisplayProps } from './BalanceDisplay';
import { BalancePillLiquid } from './BalancePill.liquid';

interface BalancePillProps extends BalanceDisplayProps {
  /** Tap handler — opens whatever picker / flow the host wants. */
  onPress?: () => void;
  /**
   * Override pill width. Defaults to the standard wallet-header title width
   * (`getHeaderTitleWidthFromWidth(window.width)`), so dropping this in
   * place of the legacy `<MintSelector />` keeps the header layout
   * identical.
   */
  width?: number;
}

const FALLBACK_HORIZONTAL_PADDING = 12;

/**
 * Full-pill balance + label header chrome shared by the wallet tab's mint
 * selector and the AI tab's Routstr balance pill. Picks the SwiftUI
 * liquid-glass variant when the OS supports it (`supportsLiquidGlass()`)
 * and falls back to a heroui `PressableFeedback` wrapped in a
 * `BlurCardFrame` otherwise. The inner `<BalanceDisplay />` is the same in
 * both branches — only the chrome differs — so visual regressions can't
 * sneak in between platforms.
 */
export default function BalancePill({
  onPress,
  width,
  contentWidth: contentWidthOverride,
  contentHeight: contentHeightOverride,
  ...display
}: BalancePillProps): React.ReactElement {
  const muted = useThemeColor('muted');
  const { width: windowWidth } = useWindowDimensions();

  const dimensions = useMemo(() => {
    const buttonWidth = width ?? getHeaderTitleWidthFromWidth(windowWidth);
    const contentWidth =
      contentWidthOverride ?? getContentWidthFromButtonWidth(buttonWidth) ?? buttonWidth;
    const contentHeight =
      contentHeightOverride ?? HEADER_LAYOUT.BUTTON_HEIGHT - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;
    return { buttonWidth, contentWidth, contentHeight };
  }, [width, windowWidth, contentWidthOverride, contentHeightOverride]);

  if (supportsLiquidGlass()) {
    return (
      <BalancePillLiquid
        {...display}
        buttonWidth={dimensions.buttonWidth}
        contentWidth={dimensions.contentWidth}
        contentHeight={dimensions.contentHeight}
        onPress={onPress}
      />
    );
  }

  const borderColor = opacity(muted, 0.3);
  // Match the glass variant's height so the header doesn't reflow when the
  // device toggles between liquid-glass and the fallback chrome.
  const cardHeight = HEADER_LAYOUT.BUTTON_HEIGHT;
  const verticalPadding = (cardHeight - dimensions.contentHeight) / 2;
  const cardRadius = cardHeight / 2;
  const fallbackContentWidth =
    contentWidthOverride ?? Math.max(0, dimensions.buttonWidth - FALLBACK_HORIZONTAL_PADDING * 2);

  return (
    <Log name="BalancePill">
      <View
        style={[
          styles.card,
          {
            borderColor,
            width: dimensions.buttonWidth,
            height: cardHeight,
            borderRadius: cardRadius,
          },
        ]}>
        <BlurCardFrame accentColor={muted}>
          <PressableFeedback
            animation={false}
            onPress={onPress}
            style={[
              styles.pressable,
              {
                width: dimensions.buttonWidth,
                height: cardHeight,
                borderRadius: cardRadius,
                paddingVertical: verticalPadding,
                paddingHorizontal: FALLBACK_HORIZONTAL_PADDING,
              },
            ]}>
            <BalanceDisplay
              {...display}
              contentWidth={fallbackContentWidth}
              contentHeight={dimensions.contentHeight}
              style={styles.fullWidth}
            />
            <PressableFeedback.Ripple />
          </PressableFeedback>
        </BlurCardFrame>
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 20,
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  card: {
    alignSelf: 'center',
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
});
