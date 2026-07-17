import type { AssetLocation } from '../ledger/ledger';

export interface DeclaredRecoveryAsset extends Omit<AssetLocation, 'accountIndex'> {
  accountIndex: 0;
  /** Upper bound for value this test run is allowed to recover from the asset. */
  maxPrincipal: number;
}

/** A scenario-declared app-internal move of value between two declared assets
 * (e.g. an inter-mint rebalance). The destination may then legitimately restore
 * more than its own principal and the source less, within `maxFeeSats`. */
export interface DeclaredAssetTransfer {
  fromMintUrl: string;
  toMintUrl: string;
  unit: string;
  accountIndex: 0;
  maxFeeSats: number;
}

export interface RestorePolicy {
  gapLimit: number;
  batchSize: number;
}

export const DEFAULT_RESTORE_POLICY: RestorePolicy = {
  gapLimit: 300,
  batchSize: 100,
};

export interface AssetReconciliation {
  asset: DeclaredRecoveryAsset;
  restoredAmount: number;
  tokenAmount: number;
  counterpartyDelta: number;
  sendFee: number;
  receiveFee: number;
  residualAmount: 0;
}

export interface FundedRecoveryReport {
  assets: AssetReconciliation[];
  counterpartyTokens: CounterpartyTokenReconciliation[];
}

export interface CounterpartyTokenReconciliation {
  asset: DeclaredRecoveryAsset;
  tokenAmount: number;
  counterpartyDelta: number;
  fee: number;
  disposition: 'returned' | 'spent-by-app';
}
