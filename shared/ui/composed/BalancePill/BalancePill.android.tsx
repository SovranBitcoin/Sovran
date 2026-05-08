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
import { View } from '@/shared/ui/primitives/View/View';
import { Log } from '@/shared/lib/logger';
import BalanceDisplay, { type BalanceDisplayProps } from './BalanceDisplay';

interface BalancePillProps extends BalanceDisplayProps {
  onPress?: () => void;
  width?: number;
}

const HORIZONTAL_PADDING = 12;

export default function BalancePill({
  onPress,
  width,
  contentWidth: contentWidthOverride,
  contentHeight: contentHeightOverride,
  ...display
}: BalancePillProps): React.ReactElement {
  const [surfaceSecondary, muted] = useThemeColor(['surface-secondary', 'muted'] as const);
  const { width: windowWidth } = useWindowDimensions();

  const dimensions = useMemo(() => {
    const buttonWidth = width ?? getHeaderTitleWidthFromWidth(windowWidth);
    const contentWidth =
      contentWidthOverride ?? getContentWidthFromButtonWidth(buttonWidth) ?? buttonWidth;
    const contentHeight =
      contentHeightOverride ?? HEADER_LAYOUT.BUTTON_HEIGHT - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;
    return { buttonWidth, contentWidth, contentHeight };
  }, [width, windowWidth, contentWidthOverride, contentHeightOverride]);

  const cardHeight = HEADER_LAYOUT.BUTTON_HEIGHT;
  const cardRadius = cardHeight / 2;
  const fallbackContentWidth =
    contentWidthOverride ?? Math.max(0, dimensions.buttonWidth - HORIZONTAL_PADDING * 2);

  return (
    <Log name="BalancePill">
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
    </Log>
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
