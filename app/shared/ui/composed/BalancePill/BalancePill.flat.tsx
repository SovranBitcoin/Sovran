import React from 'react';
import { StyleSheet } from 'react-native';

import { PressableFeedback } from 'heroui-native';

import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { View } from '@/shared/ui/primitives/View/View';
import BalanceDisplay from './BalanceDisplay';
import type { BalancePillProps } from './BalancePill.types';
import { useControlChrome } from '@/shared/styles/appStyle';
import { useBalancePillDimensions } from './useBalancePillDimensions';

const HORIZONTAL_PADDING = 12;

export default function BalancePillFlat({
  testID,
  onPress,
  width,
  height,
  contentWidth: contentWidthOverride,
  contentHeight: contentHeightOverride,
  ...display
}: BalancePillProps): React.ReactElement {
  const chrome = useControlChrome();
  const dimensions = useBalancePillDimensions({
    width,
    contentWidth: contentWidthOverride,
    contentHeight: contentHeightOverride,
  });

  const cardHeight = height ?? HEADER_LAYOUT.BUTTON_HEIGHT;
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
          ...chrome,
        },
      ]}>
      <PressableFeedback
        testID={testID}
        animation={false}
        // The liquid tier is a native SwiftUI Button and gets the button trait
        // from the platform; this tier is the Android + non-glass iOS path and
        // has to declare it. No accessibilityLabel on purpose — the flattened
        // subtree already announces the balance text, which e2e selectors match.
        accessibilityRole="button"
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
