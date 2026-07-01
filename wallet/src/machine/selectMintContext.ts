import type { LocalizedReason } from '../formatting/locales';

// ---------------------------------------------------------------------------
// Mint Availability — re-exported for wallet UI consumption
// ---------------------------------------------------------------------------

export interface MintAvailability {
  mintUrl: string;
  balance: number;
  status: 'available' | 'disabled';
  reason: LocalizedReason | null;
  isPreferred: boolean;
}
