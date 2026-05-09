/**
 * Wallet header layout constants and dimension helpers.
 * Used by the wallet tab layout and screens that need consistent header sizing.
 *
 * Components should pull width from `useWindowDimensions()` and pass it into
 * `getHeaderTitleWidthFromWidth(windowWidth)` so layout reacts to orientation
 * and split-view changes.
 */

/** Shared header layout constants for calculating title dimensions. */
export const HEADER_LAYOUT = {
  TOOLBAR_BUTTON_WIDTH: 44,
  HORIZONTAL_PADDING: 16,
  BUTTON_SPACING: 12,
  BUTTON_HEIGHT: 54,
  CONTENT_PADDING_HORIZONTAL: 16,
  CONTENT_PADDING_VERTICAL: 14,
  ANDROID_OVERLAY_OFFSET: 8,
  ANDROID_BUTTON_SIZE: 44,
} as const;

const SIDE =
  HEADER_LAYOUT.TOOLBAR_BUTTON_WIDTH +
  HEADER_LAYOUT.HORIZONTAL_PADDING +
  HEADER_LAYOUT.BUTTON_SPACING;

/** Use in components with useWindowDimensions().width for reactive layout. */
export function getHeaderTitleWidthFromWidth(windowWidth: number): number {
  return windowWidth - SIDE * 2;
}

/** Content width derived from button width (e.g. for BalanceDisplay inside header). */
export function getContentWidthFromButtonWidth(
  buttonWidth: number | undefined
): number | undefined {
  if (buttonWidth === undefined) return undefined;
  return Math.max(0, buttonWidth - HEADER_LAYOUT.CONTENT_PADDING_HORIZONTAL);
}
