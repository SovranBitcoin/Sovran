/**
 * Subscribes to coco events for payment status.
 * Receive (mint): mint-op:quote-state-changed (PAID) or mint-op:pending (PAID) → mint-op:finalized.
 * Receive (ecash): toast shown on redeem button → receive:created updates to confirmed.
 * Send: send:finalized confirms an active send/payment-request toast when present,
 * otherwise shows the standard send confirmation toast.
 * Melt: toast shown on confirm button → melt-op:finalized updates to confirmed.
 */

import { useEffect, useRef } from 'react';

import { useManagerContext } from '@cashu/coco-react';

import { paymentStatusPopup } from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { paymentLog } from '@/shared/lib/logger';

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
    if (!manager) {
      paymentLog.debug('hook.payment_status.no_manager');
      return;
    }
    paymentLog.info('hook.payment_status.subscribing');
    cancelledRef.current = false;

    const offStateChanged = manager.on(
      'mint-op:quote-state-changed',
      async ({
        mintUrl,
        quoteId,
        state,
      }: {
        mintUrl: string;
        quoteId: string;
        state: string;
        operationId: string;
        operation: any;
      }) => {
        paymentLog.debug('hook.payment_status.mint_quote_state_changed', {
          quoteId,
          state,
          mintUrl,
        });
        if (state !== 'PAID') return;

        const history = await manager.history.getPaginatedHistory(0, 100);
        const entry = history.find(
          (h) =>
            h.type === 'mint' && 'quoteId' in h && h.quoteId === quoteId && h.mintUrl === mintUrl
        );
        if (!entry || !('amount' in entry)) return;

        const amount = entry.amount ?? 0;
        const unit = entry.unit ?? 'sat';

        paymentLog.info('hook.payment_status.receive_processing', {
          quoteId,
          mintUrl,
          amount,
          unit,
        });
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
      'mint-op:pending',
      ({
        mintUrl,
        operationId,
        operation,
      }: {
        mintUrl: string;
        operationId: string;
        operation: any;
      }) => {
        const op = operation as any;
        const quoteId = op.quote?.quoteId ?? operationId;
        const state = op.quote?.state ?? op.lastObservedRemoteState;
        paymentLog.debug('hook.payment_status.mint_quote_added', { quoteId, state, mintUrl });
        if (state !== 'PAID') return;

        const paidAt = op.quote?.paidAt ?? op.updatedAt;
        const createdAt = op.createdAt;
        if (!shouldShowNpcReceivePopup({ paidAt, createdAt })) {
          paymentLog.debug('hook.payment_status.npc_quote_too_old', { quoteId });
          return;
        }

        const amount = op.intent?.amount ?? 0;
        const unit = op.intent?.unit ?? 'sat';

        paymentLog.info('hook.payment_status.npc_receive_processing', {
          quoteId,
          mintUrl,
          amount,
          unit,
        });
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

    const offRedeemed = manager.on(
      'mint-op:finalized',
      ({ operationId }: { mintUrl: string; operationId: string; operation: any }) => {
        paymentLog.info('hook.payment_status.mint_quote_redeemed', { operationId });
        usePaymentStatusStore.getState().setConfirmed(operationId);
      }
    );

    const offReceiveCreated = manager.on(
      'receive:created',
      async ({ mintUrl, token }: { mintUrl: string; token: { proofs: { amount: number }[] } }) => {
        const amount = token.proofs.reduce((acc, p) => acc + p.amount, 0);
        paymentLog.info('hook.payment_status.receive_created', {
          mintUrl,
          amount,
          proofCount: token.proofs.length,
        });
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
        paymentLog.info('hook.payment_status.send_finalized', { operationId, mintUrl, amount });
        const store = usePaymentStatusStore.getState();
        const hadPending =
          (store.active?.id === operationId &&
            (store.active.variant === 'send' || store.active.variant === 'payment-request')) ||
          (store.active?.variant === 'payment-request' &&
            (store.active?.state === 'processing' || store.active?.state === 'delivered'));

        if (hadPending) {
          store.setConfirmed(store.active!.id, { operationId });
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

    const offMeltRolledBack = manager.on(
      'melt-op:rolled-back',
      ({ operation }: { operation: { error?: string } }) => {
        paymentLog.warn('hook.payment_status.melt_rolled_back', { error: operation.error });
        const store = usePaymentStatusStore.getState();
        if (store.active?.variant === 'melt' && store.active?.state === 'processing') {
          paymentLog.error('hook.payment_status.melt_failed', {
            id: store.active.id,
            error: operation.error,
          });
          store.setFailed(store.active.id, new Error(operation.error ?? 'Payment was rolled back'));
        }
      }
    );

    const offMeltFinalized = manager.on(
      'melt-op:finalized',
      ({ mintUrl, operationId, operation }) => {
        if (!('quoteId' in operation) || !('amount' in operation)) return;
        paymentLog.info('hook.payment_status.melt_finalized', {
          operationId,
          mintUrl,
          quoteId: operation.quoteId,
          amount: operation.amount,
        });
        const store = usePaymentStatusStore.getState();
        // Match by variant, not quoteId — the machine's onPaymentProcessing
        // uses a timestamp-based ID that won't match the real quoteId.
        const hadActive =
          store.active?.variant === 'melt' &&
          (store.active?.state === 'processing' || store.active?.state === 'confirmed');

        if (hadActive) {
          // Still processing → confirm. Already confirmed → just merge operationId for View button.
          store.setConfirmed(store.active!.id, { operationId });
        } else {
          // Background melt (no active toast) — show new confirmed toast
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
      paymentLog.debug('hook.payment_status.unsubscribing');
      cancelledRef.current = true;
      offStateChanged();
      offAdded();
      offRedeemed();
      offReceiveCreated();
      offSendFinalized();
      offMeltRolledBack();
      offMeltFinalized();
    };
  }, [manager]);
}
