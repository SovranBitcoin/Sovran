import React from 'react';
import { StyleSheet } from 'react-native';

import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { View } from '@/shared/ui/primitives/View/View';
import BalanceDisplay from './BalanceDisplay';
import type { BalancePillProps } from './BalancePill.types';
import { useBalancePillDimensions } from './useBalancePillDimensions';

const HORIZONTAL_PADDING = 12;

export default function BalancePillFlat({
  onPress,
  width,
  contentWidth: contentWidthOverride,
  contentHeight: contentHeightOverride,
  ...display
}: BalancePillProps): React.ReactElement {
  const [surfaceSecondary, muted] = useThemeColor(['surface-secondary', 'muted'] as const);
  const dimensions = useBalancePillDimensions({
    width,
    contentWidth: contentWidthOverride,
    contentHeight: contentHeightOverride,
  });

  const cardHeight = HEADER_LAYOUT.BUTTON_HEIGHT;
  const cardRadius = cardHeight / 2;
  const fallbackContentWidth =
    contentWidthOverride ?? Math.max(0, dimensions.buttonWidth - HORIZONTAL_PADDING * 2);

  return (
    <View
      style={[
        styles.card,
        {
          width: dimensions.buttonWidth,
          height: cardHeight,
          borderRadius: cardRadius,
          backgroundColor: surfaceSecondary,
          borderColor: opacity(muted, 0.3),
        },
      ]}>
      <PressableFeedback
        animation={false}
        onPress={onPress}
        style={[
          styles.pressable,
          {
            width: dimensions.buttonWidth,
            height: cardHeight,
            borderRadius: cardRadius,
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
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'center',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  card: {
    alignSelf: 'center',
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
});
