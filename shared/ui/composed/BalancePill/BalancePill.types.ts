import type { BalanceDisplayProps } from './BalanceDisplay';

export interface BalancePillProps extends BalanceDisplayProps {
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
