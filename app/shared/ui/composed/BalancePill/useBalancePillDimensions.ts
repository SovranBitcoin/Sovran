import { useWindowDimensions } from 'react-native';

import { getHeaderTitleWidthFromWidth, HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';

interface DimensionInputs {
  width?: number;
  height?: number;
  contentHeight?: number;
}

/**
 * Single source of truth for the BalancePill's outer size and its balance
 * row's height. Keeps liquid / blur / flat variants pixel-aligned so the
 * wallet header doesn't reflow when the device toggles between them.
 */
export function useBalancePillDimensions({ width, height, contentHeight }: DimensionInputs): {
  buttonWidth: number;
  buttonHeight: number;
  contentHeight: number;
} {
  const { width: windowWidth } = useWindowDimensions();
  return {
    buttonWidth: width ?? getHeaderTitleWidthFromWidth(windowWidth),
    buttonHeight: height ?? HEADER_LAYOUT.BUTTON_HEIGHT,
    contentHeight:
      contentHeight ?? HEADER_LAYOUT.BUTTON_HEIGHT - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL,
  };
}
