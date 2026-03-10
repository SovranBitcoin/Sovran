import type {
  OfflineSendSuggestions,
  OfflineFiatSendSuggestions,
} from '@/features/send/lib/offlineSendSuggestions';

// ---------------------------------------------------------------------------
// Denomination
// ---------------------------------------------------------------------------

export type Denomination = 'sat' | 'fiat';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface SendMachineError {
  code: string;
  message: string;
  recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface SendMachineContext {
  denomination: Denomination;
  amountSat: number;
  fiatAmount: number | null;
  /** Sat range that maps to the requested fiat minor-unit (for offline fiat matching) */
  fiatSatRange: { min: number; max: number } | null;
  mintUrl: string | null;
  mintBalance: number;
  isOffline: boolean;
  offlineSuggestions: OfflineSendSuggestions | null;
  fiatOfflineSuggestions: OfflineFiatSendSuggestions | null;
  /** Amount resolved by the offline algorithm (exact match, fiat range, or rounding) */
  resolvedAmount: number | null;
  token: string | null;
  operationId: string | null;
  /** Serialized SendHistoryEntry for navigating to SendTokenScreen */
  historyEntryJson: string | null;
  error: SendMachineError | null;
}

// ---------------------------------------------------------------------------
// Input (machine initialization)
// ---------------------------------------------------------------------------

export interface SendMachineInput {
  denomination?: Denomination;
  mintUrl?: string | null;
  amountSat?: number;
  fiatAmount?: number | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SendMachineEvent =
  | { type: 'NEXT' }
  | { type: 'SET_AMOUNT'; amountSat: number; fiatAmount?: number | null }
  | { type: 'SET_DENOMINATION'; denomination: Denomination }
  | { type: 'SET_MINT'; mintUrl: string }
  | { type: 'MINT_SELECTED'; mintUrl: string }
  | { type: 'ROUND_UP' }
  | { type: 'ROUND_DOWN' }
  | { type: 'CANCEL' }
  | { type: 'RETRY' }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Actor output types
// ---------------------------------------------------------------------------

export interface CheckBalanceOutput {
  balance: number;
}

export interface CheckConnectivityOutput {
  isOnline: boolean;
}

export interface ExecuteSendOutput {
  token: string;
  operationId: string;
  /** JSON-serializable history entry for navigation to SendTokenScreen */
  historyEntryJson: string | null;
}

export type OfflineResolutionResult =
  | { type: 'exact'; amount: number }
  | { type: 'fiat-range'; amount: number }
  | {
      type: 'impossible';
      suggestions: OfflineSendSuggestions | null;
      fiatSuggestions: OfflineFiatSendSuggestions | null;
    };
