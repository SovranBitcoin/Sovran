import type { HistoryEntry } from '@cashu/coco-core';
import { isPendingPaymentRequestEntry } from 'wallet';

type TransactionActionDirection = 'send' | 'receive';
type TransactionActionLabel = 'Send' | 'Receive' | 'Request';

const TRANSACTION_ACTION_DIRECTION_BY_TYPE = {
  melt: 'send',
  send: 'send',
  mint: 'receive',
  receive: 'receive',
} as const satisfies Record<HistoryEntry['type'], TransactionActionDirection>;

const TRANSACTION_ACTION_LABEL_BY_TYPE = {
  melt: 'Send',
  send: 'Send',
  mint: 'Receive',
  receive: 'Receive',
} as const satisfies Record<HistoryEntry['type'], TransactionActionLabel>;

export function getTransactionActionDirection(
  type: HistoryEntry['type']
): TransactionActionDirection {
  return TRANSACTION_ACTION_DIRECTION_BY_TYPE[type];
}

export function getTransactionActionLabel(type: HistoryEntry['type']): TransactionActionLabel {
  return TRANSACTION_ACTION_LABEL_BY_TYPE[type];
}

/**
 * Row label for a full history entry. A pending incoming payment request is a
 * synthetic `receive` row awaiting payment — it reads "Request", not "Receive",
 * so the list distinguishes "I asked for ecash" from "ecash arrived".
 */
export function getTransactionRowLabel(entry: HistoryEntry): TransactionActionLabel {
  if (isPendingPaymentRequestEntry(entry)) return 'Request';
  return TRANSACTION_ACTION_LABEL_BY_TYPE[entry.type];
}
