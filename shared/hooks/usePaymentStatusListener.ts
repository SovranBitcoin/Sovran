/**
 * Subscribes to coco events for payment status.
 * Receive (mint): mint-quote:state-changed (PAID) or mint-quote:added (PAID) → mint-quote:redeemed.
 * Receive (ecash): toast shown on redeem button → receive:created updates to confirmed.
 * Send: send:finalized confirms an active send/payment-request toast when present,
 * otherwise shows the standard send confirmation toast.
 * Melt: toast shown on confirm button → melt-op:finalized updates to confirmed.
 */

import { useEffect, useRef } from 'react';

import { useManagerContext } from 'coco-cashu-react';

import { paymentStatusPopup } from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';

const NPC_RECEIVE_POPUP_MAX_AGE_MS = 2 * 60 * 1000;

function getNpcQuoteTimestampMs(quote: Pick<RawMintQuote, 'paidAt' | 'createdAt'>): number | null {
  const rawTimestamp = quote.paidAt ?? quote.createdAt;
  if (typeof rawTimestamp !== 'number' || !Number.isFinite(rawTimestamp) || rawTimestamp <= 0) {
    return null;
  }

  return rawTimestamp * 1000;
}

function shouldShowNpcReceivePopup(
  quote: Pick<RawMintQuote, 'paidAt' | 'createdAt'>,
  nowMs: number = Date.now()
): boolean {
  const quoteTimestampMs = getNpcQuoteTimestampMs(quote);
  if (quoteTimestampMs === null) return true;

  return nowMs - quoteTimestampMs <= NPC_RECEIVE_POPUP_MAX_AGE_MS;
}

type RawMintQuote = {
  state?: string;
  amount?: number;
  unit?: string;
  paidAt?: number;
  createdAt?: number;
};

export function usePaymentStatusListener(): void {
  const { manager } = useManagerContext();
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!manager) return;
    cancelledRef.current = false;

    const offStateChanged = manager.on(
      'mint-quote:state-changed',
      async ({ mintUrl, quoteId, state }: { mintUrl: string; quoteId: string; state: string }) => {
        if (state !== 'PAID') return;

        const history = await manager.history.getPaginatedHistory(0, 100);
        const entry = history.find(
          (h) =>
            h.type === 'mint' && 'quoteId' in h && h.quoteId === quoteId && h.mintUrl === mintUrl
        );
        if (!entry || !('amount' in entry)) return;

        const amount = entry.amount ?? 0;
        const unit = entry.unit ?? 'sat';

        usePaymentStatusStore.getState().setActive({
          variant: 'receive',
          id: quoteId,
          mintUrl,
          amount,
          unit,
          state: 'processing',
        });

        paymentStatusPopup({ variant: 'receive', id: quoteId, mintUrl, amount, unit });
      }
    );

    const offAdded = manager.on(
      'mint-quote:added',
      ({ mintUrl, quoteId, quote }: { mintUrl: string; quoteId: string; quote: RawMintQuote }) => {
        if (quote.state !== 'PAID') return;
        if (!shouldShowNpcReceivePopup(quote)) return;

        const amount = quote.amount ?? 0;
        const unit = quote.unit ?? 'sat';

        usePaymentStatusStore.getState().setActive({
          variant: 'receive',
          id: quoteId,
          mintUrl,
          amount,
          unit,
          state: 'processing',
        });

        paymentStatusPopup({ variant: 'receive', id: quoteId, mintUrl, amount, unit });
      }
    );

    const offRedeemed = manager.on('mint-quote:redeemed', ({ quoteId }: { quoteId: string }) => {
      usePaymentStatusStore.getState().setConfirmed(quoteId);
    });

    const offReceiveCreated = manager.on(
      'receive:created',
      async ({ mintUrl, token }: { mintUrl: string; token: { proofs: { amount: number }[] } }) => {
        const amount = token.proofs.reduce((acc, p) => acc + p.amount, 0);
        const store = usePaymentStatusStore.getState();
        const hadPending =
          store.active?.variant === 'receive-ecash' &&
          store.active?.amount === amount &&
          store.active?.mintUrl === mintUrl;

        if (hadPending && store.active) {
          // Brief delay so HistoryService.handleReceiveCreated can persist the entry
          await new Promise((r) => setTimeout(r, 50));
          if (cancelledRef.current) return;
          const history = await manager.history.getPaginatedHistory(0, 20);
          const realEntry = history.find(
            (h) => h.type === 'receive' && h.amount === amount && h.mintUrl === mintUrl
          );
          if (realEntry?.id) {
            store.setConfirmed(store.active.id, { receiveEntryId: realEntry.id });
          }
        }
      }
    );

    const offSendFinalized = manager.on(
      'send:finalized',
      ({
        mintUrl,
        operationId,
        operation,
      }: {
        mintUrl: string;
        operationId: string;
        operation: { amount: number };
      }) => {
        const amount = operation.amount;
        const unit = 'sat';
        const store = usePaymentStatusStore.getState();
        const hadPending =
          store.active?.id === operationId &&
          (store.active.variant === 'send' || store.active.variant === 'payment-request');

        if (hadPending) {
          store.setConfirmed(operationId);
          return;
        }

        store.setActive({
          variant: 'send',
          id: operationId,
          mintUrl,
          amount,
          unit,
          state: 'confirmed',
        });

        paymentStatusPopup({ variant: 'send', id: operationId, mintUrl, amount, unit });
      }
    );

    const offMeltFinalized = manager.on(
      'melt-op:finalized',
      ({ mintUrl, operationId, operation }) => {
        if (!('quoteId' in operation) || !('amount' in operation)) return;
        const store = usePaymentStatusStore.getState();
        const hadPending =
          store.active?.id === operation.quoteId && store.active?.state === 'processing';

        if (hadPending) {
          store.setConfirmed(operation.quoteId, { operationId });
        } else {
          const amount = operation.amount;
          const unit = 'sat';
          store.setActive({
            variant: 'melt',
            id: operation.quoteId,
            mintUrl,
            amount,
            unit,
            state: 'confirmed',
          });

          paymentStatusPopup({
            variant: 'melt',
            id: operation.quoteId,
            mintUrl,
            amount,
            unit,
            operationId,
          });
        }
      }
    );

    return () => {
      cancelledRef.current = true;
      offStateChanged();
      offAdded();
      offRedeemed();
      offReceiveCreated();
      offSendFinalized();
      offMeltFinalized();
    };
  }, [manager]);
}
