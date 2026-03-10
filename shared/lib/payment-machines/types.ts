import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type {
  Manager,
  MeltHistoryEntry,
  MintHistoryEntry,
  SendHistoryEntry,
} from 'coco-cashu-core';

import type {
  ExactOfflineAmountIndex,
  OfflineFiatSendSuggestions,
  OfflineSendSuggestions,
} from '@/features/send/lib/offlineSendSuggestions';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface PaymentError {
  code: string;
  message: string;
  recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Base context shared by all payment machines
// ---------------------------------------------------------------------------

export interface BasePaymentContext {
  mintUrl: string | null;
  amount: number;
  mintBalance: number;
  isOffline: boolean;
  manager: Manager | null;
  error: PaymentError | null;
}

// ---------------------------------------------------------------------------
// sendToken machine
// ---------------------------------------------------------------------------

export interface SendTokenContext extends BasePaymentContext {
  type: 'sendToken';
  offlineSendability: ExactOfflineAmountIndex | null;
  offlineSuggestions: OfflineSendSuggestions | OfflineFiatSendSuggestions | null;
  /** When fiat auto-offline optimization finds a match, the adjusted sat amount */
  fiatOfflineAmount: number | null;
  token: string | null;
  historyEntry: SendHistoryEntry | null;
  operationId: string | null;
  unit: string;
  scanRaw: string | null;
  /** BTC price in display currency, needed for fiat offline optimization */
  btcPrice: number | null;
}

// ---------------------------------------------------------------------------
// meltQuote machine
// ---------------------------------------------------------------------------

interface MeltQuoteContext extends BasePaymentContext {
  type: 'meltQuote';
  lnUrlOrAddress: string | null;
  invoice: string | null;
  quote: MeltQuoteBolt11Response | null;
  historyEntry: MeltHistoryEntry | null;
  operationId: string | null;
}

// ---------------------------------------------------------------------------
// mintQuote (receive Lightning) machine
// ---------------------------------------------------------------------------

export interface MintQuoteContext extends BasePaymentContext {
  type: 'mintQuote';
  mintQuote: MeltQuoteBolt11Response | null;
  historyEntry: MintHistoryEntry | null;
}

export interface MintQuoteInput {
  mintUrl?: string | null;
  amount?: number;
  manager: Manager | null;
}

// ---------------------------------------------------------------------------
// paymentRequest (NUT-18) machine
// ---------------------------------------------------------------------------

interface PaymentRequestContext extends BasePaymentContext {
  type: 'paymentRequest';
  paymentRequest: string;
  decodedRequest: unknown | null;
  nostrTransport: unknown | null;
  recipientInfo: unknown | null;
  allowedMints: string[];
  token: string | null;
  historyEntry: SendHistoryEntry | null;
  operationId: string | null;
  nostrSent: boolean;
}

// ---------------------------------------------------------------------------
// NFC send machine
// ---------------------------------------------------------------------------

interface NfcSendContext extends BasePaymentContext {
  type: 'nfcSend';
  maxAmountSats: number | undefined;
  scannedData: string | null;
  paymentRequest: string | null;
  allowedMints: string[];
  selectedMint: string | null;
  token: string | null;
  operationId: string | null;
  historyEntry: SendHistoryEntry | null;
}

// ---------------------------------------------------------------------------
// QR/scan router — parsed result
// ---------------------------------------------------------------------------

export type ParsedPaymentType =
  | 'ur'
  | 'ecash'
  | 'paymentRequest'
  | 'lightningInvoice'
  | 'lightningAddress'
  | 'mintUrl'
  | 'npub'
  | 'unknown';

export interface ParsedPaymentString {
  type: ParsedPaymentType;
  data: string;
  amount?: number;
  allowedMints?: string[];
}

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

export interface SendResult {
  token: string;
  historyEntry: SendHistoryEntry;
  operationId: string;
}

export interface MeltQuoteResult {
  quote: MeltQuoteBolt11Response;
  historyEntry: MeltHistoryEntry;
  operationId: string;
}
