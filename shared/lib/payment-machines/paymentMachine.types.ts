import type { MintHistoryEntry } from 'coco-cashu-core';

import type { SendMachineContext, SendMachineEvent, SendMachineInput } from './sendMachine.types';

// ---------------------------------------------------------------------------
// Extended context — sendMachine context + mintQuote (receive Lightning) fields
// ---------------------------------------------------------------------------

export interface PaymentMachineContext extends SendMachineContext {
  /** Raw mintQuote object returned by manager.quotes.createMintQuote */
  mintQuoteData: unknown | null;
  /** History entry created when the mint quote is created */
  mintHistoryEntry: MintHistoryEntry | null;
}

// ---------------------------------------------------------------------------
// Extended input
// ---------------------------------------------------------------------------

export interface PaymentMachineInput extends SendMachineInput {
  /** Pre-set receive amount when entering mintQuote directly */
  receiveAmount?: number;
}

// ---------------------------------------------------------------------------
// Extended events — sendMachine events + mintQuote events
// ---------------------------------------------------------------------------

export type PaymentMachineEvent =
  | SendMachineEvent
  | { type: 'REQUEST_INVOICE' }
  | { type: 'SET_RECEIVE_AMOUNT'; amount: number }
  | { type: 'PAYMENT_RECEIVED' }
  | { type: 'QUOTE_EXPIRED' };
