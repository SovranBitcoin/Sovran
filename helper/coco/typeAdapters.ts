import { HistoryEntry, MintHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';

/**
 * Type adapters to bridge between Coco's HistoryEntry types and legacy TransactionData expectations
 */

export type CocoTransactionAdapter = {
  id: string;
  type: 'send' | 'mint' | 'melt' | 'receive';
  amount: number;
  unit: string;
  createdAt: number;
  mintUrl: string;
  paid?: boolean;
  state?: 'PAID' | 'UNPAID' | 'PENDING' | 'SPENT';
  batchId?: string;
  // For ecash transactions
  token?: string;
  // For Lightning transactions
  request?: string;
  paymentRequest?: string;
  unifiedRequest?: string;
  // For Lightning sends
  meltQuote?: any;
  lud16?: string;
  nostr?: { pubkey?: string };
};

/**
 * Convert Coco HistoryEntry to legacy TransactionData format
 */
export function adaptCocoHistoryToTransaction(entry: HistoryEntry): CocoTransactionAdapter {
  const base = {
    id: entry.id,
    type: entry.type,
    amount: entry.amount,
    unit: entry.unit,
    createdAt: entry.createdAt,
    mintUrl: entry.mintUrl,
    paid: 'state' in entry ? entry.state === 'PAID' : false,
    state: 'state' in entry ? entry.state : undefined,
  };

  if (entry.type === 'mint') {
    const mintEntry = entry as MintHistoryEntry;
    return {
      ...base,
      type: 'mint',
      request: 'request' in mintEntry ? mintEntry.request : undefined,
      paymentRequest: 'paymentRequest' in mintEntry ? mintEntry.paymentRequest : undefined,
      unifiedRequest: 'unifiedRequest' in mintEntry ? mintEntry.unifiedRequest : undefined,
      token: 'token' in mintEntry ? mintEntry.token : undefined,
    };
  }

  if (entry.type === 'send') {
    const sendEntry = entry as SendHistoryEntry;
    return {
      ...base,
      type: 'send',
      token: 'token' in sendEntry ? sendEntry.token : undefined,
      request: 'request' in sendEntry ? sendEntry.request : undefined,
      paymentRequest: 'paymentRequest' in sendEntry ? sendEntry.paymentRequest : undefined,
      meltQuote: 'meltQuote' in sendEntry ? sendEntry.meltQuote : undefined,
      lud16: 'lud16' in sendEntry ? sendEntry.lud16 : undefined,
      nostr: 'nostr' in sendEntry ? sendEntry.nostr : undefined,
    };
  }

  return base;
}

/**
 * Check if a Coco transaction is paid
 */
export function isCocoTransactionPaid(entry: HistoryEntry): boolean {
  return 'state' in entry ? entry.state === 'PAID' : false;
}

/**
 * Get transaction type for display
 */
export function getCocoTransactionType(entry: HistoryEntry): 'send' | 'receive' {
  if (entry.type === 'send') return 'send';
  if (entry.type === 'mint') return 'receive';
  return 'receive'; // default
}
