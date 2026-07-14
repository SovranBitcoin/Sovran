import type { BalanceDisplayProps } from './BalanceDisplay';

export interface BalancePillProps extends BalanceDisplayProps {
  /** Stable identifier forwarded to the platform-native interactive control. */
  testID?: string;
  /** Tap handler — opens whatever picker / flow the host wants. */
  onPress?: () => void;
  /**
   * Override pill width. Defaults to the standard wallet-header title width
   * (`getHeaderTitleWidthFromWidth(window.width)`), so dropping this in
   * place of the legacy `<MintSelector />` keeps the header layout
   * identical.
   */
  width?: number;
  /**
   * Override pill height. Defaults to `HEADER_LAYOUT.BUTTON_HEIGHT` (54) so
   * the wallet header doesn't reflow. Pass a smaller value when the pill is
   * used outside the header (e.g. the amount-entry bottom row, which sits
   * next to a 48 px Button primitive).
   */
  height?: number;
}
