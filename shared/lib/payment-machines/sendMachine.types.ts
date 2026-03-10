import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type {
  Manager,
  MeltHistoryEntry,
  ReceiveHistoryEntry,
  SendHistoryEntry,
} from 'coco-cashu-core';

import type {
  ExactOfflineAmountIndex,
  OfflineFiatSendSuggestions,
  OfflineSendSuggestions,
} from '@/features/send/lib/offlineSendSuggestions';

import type { PaymentError, ParsedPaymentType, ParsedPaymentString } from './types';

export type { ParsedPaymentType, ParsedPaymentString };

// ---------------------------------------------------------------------------
// Source & parsed result (absorbed from qrScanRouter)
// ---------------------------------------------------------------------------

export type SendSource = 'qr' | 'paste' | 'deeplink' | 'nfc' | 'direct';

// ---------------------------------------------------------------------------
// Send branch — determines which execution phase to enter
// ---------------------------------------------------------------------------

export type SendBranch = 'ecash' | 'melt' | 'nfc' | 'paymentRequest' | null;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface SendMachineContext {
  // Input source tracking
  source: SendSource;
  rawData: string | null;
  parsedResult: ParsedPaymentString | null;

  // Camera / UR state
  cameraPermission: 'unknown' | 'granted' | 'denied';
  urProgress: number;

  // Core payment fields
  mintUrl: string | null;
  amount: number;
  mintBalance: number;
  isOffline: boolean;
  manager: Manager | null;
  error: PaymentError | null;

  // Branch routing
  sendBranch: SendBranch;

  // Ecash send fields
  token: string | null;
  historyEntry: SendHistoryEntry | null;
  operationId: string | null;
  offlineSendability: ExactOfflineAmountIndex | null;
  offlineSuggestions: OfflineSendSuggestions | OfflineFiatSendSuggestions | null;
  fiatOfflineAmount: number | null;
  unit: string;
  scanRaw: string | null;
  btcPrice: number | null;

  // Melt fields
  lnUrlOrAddress: string | null;
  invoice: string | null;
  quote: MeltQuoteBolt11Response | null;
  meltHistoryEntry: MeltHistoryEntry | null;
  meltOperationId: string | null;

  // NFC fields
  maxAmountSats: number | undefined;
  allowedMints: string[];
  selectedMint: string | null;
  paymentRequest: string | null;

  // Payment request (NUT-18)
  isPaymentRequest: boolean;
  /** Raw encoded NUT-18 payment request string (creqA...) for paymentRequest send branch */
  encodedPaymentRequest: string | null;

  // Ecash receive fields
  /** 'ecashReceive' to enter the token redemption branch */
  receiveBranch: 'ecashReceive' | null;
  /** Encoded token string to redeem */
  tokenString: string | null;
  /** Set to true when redemption fails due to already-spent proofs */
  isAlreadySpent: boolean;
  /** Populated after a successful receive — the history entry created by coco */
  receiveHistoryEntry: ReceiveHistoryEntry | null;
}

// ---------------------------------------------------------------------------
// Input (machine initialization)
// ---------------------------------------------------------------------------

export interface SendMachineInput {
  // Source-specific
  source?: SendSource;

  // Direct initialization (skip input phase)
  sendBranch?: SendBranch;
  mintUrl?: string | null;
  amount?: number;
  mintBalance?: number;
  isOffline?: boolean;
  manager?: Manager | null;
  unit?: string;
  scanRaw?: string | null;
  btcPrice?: number | null;
  offlineSendability?: ExactOfflineAmountIndex | null;

  // Melt direct init
  lnUrlOrAddress?: string | null;
  invoice?: string | null;

  // NFC direct init
  maxAmountSats?: number;

  // Payment request direct init
  encodedPaymentRequest?: string | null;

  // Ecash receive direct init
  receiveBranch?: 'ecashReceive' | null;
  tokenString?: string | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SendMachineEvent =
  // Input events
  | { type: 'SCAN'; data: string; source: 'qr' | 'paste' | 'deeplink' }
  | { type: 'START_NFC'; maxAmountSats?: number }
  | { type: 'UR_PROGRESS'; progress: number }
  | { type: 'UR_COMPLETE'; data: string }

  // Setup events
  | { type: 'SET_AMOUNT'; amount: number }
  | { type: 'SET_MINT'; mintUrl: string; mintBalance: number }
  | { type: 'SET_MANAGER'; manager: Manager }
  | { type: 'NEXT' }

  // Branch switching
  | { type: 'SET_PAYMENT_REQUEST'; encodedPaymentRequest: string }

  // Offline suggestion events
  | { type: 'SELECT_AMOUNT'; amount: number }

  // Melt events
  | { type: 'EXECUTE' }
  | { type: 'CHANGE_MINT'; mintUrl: string; mintBalance: number }

  // NFC events
  | { type: 'FINALIZED'; historyEntry: SendHistoryEntry }

  // Ecash receive
  | { type: 'REDEEM' }

  // Universal
  | { type: 'CANCEL' }
  | { type: 'RESET' }
  | { type: 'RETRY' };
