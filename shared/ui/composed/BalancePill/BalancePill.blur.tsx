import React from 'react';
import { StyleSheet } from 'react-native';

import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { View } from '@/shared/ui/primitives/View/View';
import BalanceDisplay from './BalanceDisplay';
import type { BalancePillProps } from './BalancePill.types';
import { useBalancePillDimensions } from './useBalancePillDimensions';

const HORIZONTAL_PADDING = 12;

export default function BalancePillBlur({
  onPress,
  width,
  height,
  contentWidth: contentWidthOverride,
  contentHeight: contentHeightOverride,
  ...display
}: BalancePillProps): React.ReactElement {
  const muted = useThemeColor('muted');
  const dimensions = useBalancePillDimensions({
    width,
    contentWidth: contentWidthOverride,
    contentHeight: contentHeightOverride,
  });

  const borderColor = opacity(muted, 0.3);
  // Match the glass variant's height so the header doesn't reflow when the
  // device toggles between liquid-glass and the fallback chrome.
  const cardHeight = height ?? HEADER_LAYOUT.BUTTON_HEIGHT;
  const verticalPadding = (cardHeight - dimensions.contentHeight) / 2;
  const cardRadius = cardHeight / 2;
  const fallbackContentWidth =
    contentWidthOverride ?? Math.max(0, dimensions.buttonWidth - HORIZONTAL_PADDING * 2);

  return (
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
              paddingHorizontal: HORIZONTAL_PADDING,
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
