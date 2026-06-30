import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import {
  getContentWidthFromButtonWidth,
  getHeaderTitleWidthFromWidth,
  HEADER_LAYOUT,
} from '@/features/wallet/lib/walletHeader';

interface DimensionInputs {
  width?: number;
  contentWidth?: number;
  contentHeight?: number;
}

interface BalancePillDimensions {
  buttonWidth: number;
  contentWidth: number;
  contentHeight: number;
}

/**
 * Single source of truth for the BalancePill's button / content dimensions.
 * Keeps liquid / blur / flat variants pixel-aligned so the wallet header
 * doesn't reflow when the device toggles between them.
 */
export function useBalancePillDimensions({
  width,
  contentWidth,
  contentHeight,
}: DimensionInputs): BalancePillDimensions {
  const { width: windowWidth } = useWindowDimensions();
  return useMemo(() => {
    const buttonWidth = width ?? getHeaderTitleWidthFromWidth(windowWidth);
    const resolvedContentWidth =
      contentWidth ?? getContentWidthFromButtonWidth(buttonWidth) ?? buttonWidth;
    const resolvedContentHeight =
      contentHeight ?? HEADER_LAYOUT.BUTTON_HEIGHT - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;
    return {
      buttonWidth,
      contentWidth: resolvedContentWidth,
      contentHeight: resolvedContentHeight,
    };
  }, [width, windowWidth, contentWidth, contentHeight]);
}
