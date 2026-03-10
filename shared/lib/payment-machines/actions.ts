import { assign } from 'xstate';

import * as Haptics from 'expo-haptics';

import { noMintSelectedPopup, paymentStatusPopup, receiveFailedPopup } from '@/shared/lib/popup';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';

import type { ReceiveHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import type { PaymentError } from './types';

// ---------------------------------------------------------------------------
// Scan history
// ---------------------------------------------------------------------------

export const linkTransactionAction = ({
  context,
}: {
  context: { scanRaw: string | null; historyEntry: { id: string } | null };
}) => {
  if (context.scanRaw && context.historyEntry) {
    useScanHistoryStore.getState().linkTransaction(context.scanRaw, context.historyEntry.id);
  }
};

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

export const hapticSuccessAction = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

export const hapticErrorAction = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------

export const noMintPopupAction = () => {
  noMintSelectedPopup();
};

export const paymentRequestSentPopupAction = ({
  context,
}: {
  context: {
    historyEntry: SendHistoryEntry | null;
    mintUrl: string | null;
    amount: number;
    unit: string;
  };
}) => {
  const entry = context.historyEntry;
  const operationId = entry?.operationId;
  if (!operationId || !context.mintUrl) return;

  usePaymentStatusStore.getState().setActive({
    variant: 'payment-request',
    id: operationId,
    mintUrl: context.mintUrl,
    amount: context.amount,
    unit: context.unit,
    state: 'processing',
  });

  paymentStatusPopup({
    variant: 'payment-request',
    id: operationId,
    mintUrl: context.mintUrl,
    amount: context.amount,
    unit: context.unit,
  });
};

// ---------------------------------------------------------------------------
// Ecash receive actions
// ---------------------------------------------------------------------------

/** Show the optimistic "processing" payment status toast when redeem starts. */
export const receiveEcashStartAction = ({
  context,
}: {
  context: {
    tokenString: string | null;
    mintUrl: string | null;
    amount: number;
    unit: string;
    receiveHistoryEntry: ReceiveHistoryEntry | null;
  };
}) => {
  // Use the receive entry id if available; fall back to a temp placeholder
  const id = context.receiveHistoryEntry?.id ?? `receive-pending-${Date.now()}`;
  const mintUrl = context.mintUrl ?? '';

  const store = usePaymentStatusStore.getState();
  // Clear any stale failed state for a retry
  if (store.active?.id === id && store.active?.state === 'failed') {
    store.setActive(null);
  }
  store.setActive({
    variant: 'receive-ecash',
    id,
    mintUrl,
    amount: context.amount,
    unit: context.unit,
    state: 'processing',
  });
  paymentStatusPopup({
    variant: 'receive-ecash',
    id,
    mintUrl,
    amount: context.amount,
    unit: context.unit,
  });
};

/** Record the failed state in the payment status store and show error popup. */
export const receiveEcashErrorAction = ({
  context,
  event,
}: {
  context: {
    receiveHistoryEntry: ReceiveHistoryEntry | null;
    mintUrl: string | null;
  };
  // XState passes the full event union — we only read the `error` property that
  // exists on xstate error events (type: 'xstate.error.actor.*').
  event: Record<string, unknown>;
}) => {
  const id = context.receiveHistoryEntry?.id ?? '';
  const error = event['error'];
  const store = usePaymentStatusStore.getState();
  if (id && store.active?.id === id) {
    store.setFailed(id, error);
  } else {
    receiveFailedPopup({
      text: error instanceof Error ? error.message : undefined,
    });
  }
};

/** Link the scan history entry to the finalized receive transaction. */
export const linkReceiveTransactionAction = ({
  context,
}: {
  context: {
    scanRaw: string | null;
    tokenString: string | null;
    receiveHistoryEntry: ReceiveHistoryEntry | null;
  };
}) => {
  const id = context.receiveHistoryEntry?.id;
  if (!id) return;
  const raw = context.scanRaw || context.tokenString;
  if (raw) {
    useScanHistoryStore.getState().linkTransaction(raw, id);
  }
};

// ---------------------------------------------------------------------------
// Melt scan history
// ---------------------------------------------------------------------------

export const linkMeltTransactionAction = ({
  context,
}: {
  context: { invoice: string | null; meltHistoryEntry: { id: string } | null };
}) => {
  if (context.invoice && context.meltHistoryEntry) {
    useScanHistoryStore.getState().linkTransaction(context.invoice, context.meltHistoryEntry.id);
  }
};

// ---------------------------------------------------------------------------
// Error assignment factory
// ---------------------------------------------------------------------------

export function assignError(code: string, recoverable = false) {
  return assign({
    error: ({ event }: { event: { error: unknown } }): PaymentError => ({
      code,
      message: event.error instanceof Error ? event.error.message : String(event.error),
      recoverable,
    }),
  });
}
