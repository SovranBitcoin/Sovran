import {
  createPaymentCopyResolver,
  type PaymentCopyResolver,
} from '../copy';
import { isReceiveTokenRedeemed, isSendTokenComplete } from './filters';

interface RefreshHistoryEntry {
  type: 'send' | 'receive' | string;
  state?: unknown;
}

const DEFAULT_PAYMENT_COPY = createPaymentCopyResolver();

export function getHistoryEntryRefreshLabel(
  historyEntry: RefreshHistoryEntry,
  paymentCopy: PaymentCopyResolver = DEFAULT_PAYMENT_COPY,
): string {
  if (historyEntry.type === 'send') {
    return paymentCopy.text(
      isSendTokenComplete(historyEntry) ? 'history.refresh.sentWith' : 'history.refresh.sendingWith',
    );
  }

  if (historyEntry.type === 'receive') {
    return paymentCopy.text(
      isReceiveTokenRedeemed(historyEntry)
        ? 'history.refresh.receivedWith'
        : 'history.refresh.receivingWith',
    );
  }

  return paymentCopy.text('history.refresh.processingWith');
}
