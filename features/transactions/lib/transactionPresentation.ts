import type { HistoryEntry } from '@cashu/coco-core';

export type TransactionActionDirection = 'send' | 'receive';
export type TransactionActionLabel = 'Send' | 'Receive';

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
