import type { AssetLocation } from '../ledger/ledger';

export interface DeclaredRecoveryAsset extends Omit<AssetLocation, 'accountIndex'> {
  accountIndex: 0;
  /** Upper bound for value this test run is allowed to recover from the asset. */
  maxPrincipal: number;
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
