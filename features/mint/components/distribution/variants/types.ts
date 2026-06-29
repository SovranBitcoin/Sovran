import type { GetInfoResponse } from '@cashu/cashu-ts';

/**
 * The single contract every Balance-split variant implements. The screen
 * container owns all state, data and handlers; variants are pure presentation.
 */
export interface DistributionVariantProps {
  /** Active mint URLs for the selected currency, in display order. */
  mintUrls: string[];
  /** Async-resolved mint metadata (name, icon) keyed by mint URL. */
  mintInfoMap: Record<string, GetInfoResponse | null | undefined>;
  /** Current target split in basis points, keyed by mint URL. */
  distribution: Record<string, number>;
  /** Live balance (in the selected unit) keyed by mint URL. */
  balanceTotals: Record<string, number>;
  /** Lowercased unit for amount formatting (e.g. "sat", "usd"). */
  unit: string;
  onDistributionChange: (mintUrl: string, bp: number) => void;
  onMax: (mintUrl: string) => void;
  onMin: (mintUrl: string) => void;
}

export type DistributionVariantComponent = React.FC<DistributionVariantProps>;
