/**
 * Wallet header layout constants and dimension helpers.
 * Used by the wallet tab layout and screens that need consistent header sizing.
 *
 * In components, prefer useWindowDimensions() + getHeaderTitleWidthFromWidth(width)
 * over getHeaderTitleWidth() so layout reacts to orientation/resize.
 */

import { Dimensions } from 'react-native';

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

/** Use when hook context not available (e.g. outside component). */
export function getHeaderTitleWidth(): number {
  return getHeaderTitleWidthFromWidth(Dimensions.get('window').width);
}

export function getHeaderTitleHeight(): number {
  return HEADER_LAYOUT.BUTTON_HEIGHT;
}

export function getHeaderContentWidth(): number {
  return getHeaderTitleWidth() - HEADER_LAYOUT.CONTENT_PADDING_HORIZONTAL;
}

/** Content dimensions from a known window width (for use with useWindowDimensions). */
export function getHeaderContentWidthFromWidth(windowWidth: number): number {
  return getHeaderTitleWidthFromWidth(windowWidth) - HEADER_LAYOUT.CONTENT_PADDING_HORIZONTAL;
}

/** Content width derived from button width (e.g. for BalanceDisplay inside header). */
export function getContentWidthFromButtonWidth(
  buttonWidth: number | undefined
): number | undefined {
  if (buttonWidth === undefined) return undefined;
  return Math.max(0, buttonWidth - HEADER_LAYOUT.CONTENT_PADDING_HORIZONTAL);
}

export function getHeaderContentHeight(): number {
  return getHeaderTitleHeight() - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;
}

/** NFC payment limit tiers for the header action menu. */
export const PAYMENT_TIERS = [
  { label: 'Up to $10', usdLimit: 10, icon: 'cup.and.saucer.fill' },
  { label: 'Up to $50', usdLimit: 50, icon: 'fork.knife' },
  { label: 'Up to $100', usdLimit: 100, icon: 'cart.fill' },
  { label: 'No limit', usdLimit: undefined, icon: 'exclamationmark.triangle.fill' },
] as const;

/** Mock amount (sats) shown in NFC success overlay when triggered from dev "Preview" button. */
export const MOCK_NFC_SUCCESS_SATS = 21;
