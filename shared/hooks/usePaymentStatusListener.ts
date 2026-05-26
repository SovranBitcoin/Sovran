/**
 * Subscribes to coco events for payment status.
 * Receive (mint): mint-op:quote-state-changed (PAID) or mint-op:pending (PAID) → mint-op:finalized.
 * Receive (ecash): toast shown on redeem button → receive:created updates to confirmed.
 * Send: send:finalized confirms an active send/payment-request toast when present,
 * otherwise shows the standard send confirmation toast.
 * Melt: toast shown on confirm button → melt-op:finalized updates to confirmed.
 */

import { useEffect } from 'react';

import { useManagerContext } from '@cashu/coco-react';
import { getMintQuoteAvailableAmount } from '@cashu/coco-core';

import { paymentStatusPopup } from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { isSwapStatusActive } from '@/shared/stores/runtime/swapStatusStore';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { paymentLog } from '@/shared/lib/logger';

const NPC_RECEIVE_POPUP_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Decide whether a `mint-op:pending` event with `lastObservedRemoteState === 'PAID'`
 * should surface a "Payment received" toast. Only NPC sync produces these events
 * (live in-app mints emit pending with state 'UNPAID' and transition via
 * quote-state-changed), so we treat anything older than the threshold — or with
 * no observed-state timestamp at all — as a retroactive replay (recovery,
 * cold-start sync) and stay silent.
 *
 * `lastObservedRemoteStateAt` is set to `Date.now()` by MintBolt11Handler.prepare
 * when the NPC plugin imports the quote, so the freshness window is "import time
 * was within 5 minutes" — newly synced NPC payments fire, stale replays don't.
 */
function shouldShowNpcReceivePopup(
  observedAtMs: number | undefined,
  nowMs: number = Date.now()
): boolean {
  if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || observedAtMs <= 0) {
    return false;
  }
  return nowMs - observedAtMs <= NPC_RECEIVE_POPUP_MAX_AGE_MS;
}

export function usePaymentStatusListener(): void {
  const { manager } = useManagerContext();

  useEffect(() => {
    if (!manager) {
      paymentLog.debug('hook.payment_status.no_manager');
      return;
    }
    paymentLog.info('hook.payment_status.subscribing');

    const offStateChanged = manager.on('mint-quote:updated', ({ mintUrl, quoteId, quote }) => {
      const remoteState = quote.method === 'bolt11' ? quote.state : undefined;
      const amountValue =
        quote.method === 'onchain' ? getMintQuoteAvailableAmount(quote) : quote.amount;
      paymentLog.debug('hook.payment_status.mint_quote_state_changed', {
        quoteId,
        state: remoteState ?? null,
        method: quote.method,
        mintUrl,
      });
      if (quote.method === 'bolt11' && remoteState !== 'PAID') return;
      if (quote.method === 'onchain' && !amountValue.greaterThan(0)) return;

      // Suppress per-leg toasts while a swap is running — the unified
      // SwapStatusToast owns the user-facing surface for the duration.
      if (isSwapStatusActive()) {
        paymentLog.info('hook.payment_status.suppressed_for_swap', {
          quoteId,
          mintUrl,
          phase: 'mint_quote_state_changed',
        });
        return;
      }

      const amount = amountToNumber(amountValue);
      const unit = quote.unit;

      const existingActive = usePaymentStatusStore.getState().active;
      const isDuplicate = existingActive?.variant === 'receive' && existingActive.id === quoteId;

      paymentLog.info('hook.payment_status.receive_processing', {
        quoteId,
        mintUrl,
        amount,
        unit,
        isDuplicate,
      });
      usePaymentStatusStore.getState().setActive({
        variant: 'receive',
        id: quoteId,
        mintUrl,
        amount,
        unit,
        state: 'processing',
      });

      if (isDuplicate) {
        paymentLog.info('hook.payment_status.receive_popup_suppressed', {
          quoteId,
          mintUrl,
          reason: 'already_active',
        });
        return;
      }

      paymentStatusPopup({ variant: 'receive', id: quoteId, mintUrl, amount, unit });
    });

    const offAdded = manager.on('mint-op:pending', ({ mintUrl, operationId, operation }) => {
      // The MintOperation union includes `init` (no quoteId/observed state); only
      // pending-or-later carries the quote snapshot we need.
      if (operation.state === 'init') {
        paymentLog.debug('hook.payment_status.mint_pending_init_skipped', {
          operationId,
          mintUrl,
        });
        return;
      }

      const {
        quoteId,
        lastObservedRemoteState: state,
        lastObservedRemoteStateAt,
        unit,
      } = operation;
      const amount = amountToNumber(operation.amount);
      paymentLog.debug('hook.payment_status.mint_quote_added', { quoteId, state, mintUrl });
      if (state !== 'PAID') return;

      if (isSwapStatusActive()) {
        paymentLog.info('hook.payment_status.suppressed_for_swap', {
          quoteId,
          mintUrl,
          phase: 'mint_quote_added',
        });
        return;
      }

      if (!shouldShowNpcReceivePopup(lastObservedRemoteStateAt)) {
        paymentLog.info('hook.payment_status.npc_quote_suppressed', {
          quoteId,
          mintUrl,
          observedAt: lastObservedRemoteStateAt ?? null,
          ageMs:
            typeof lastObservedRemoteStateAt === 'number'
              ? Date.now() - lastObservedRemoteStateAt
              : null,
          reason: lastObservedRemoteStateAt == null ? 'no_observed_at' : 'too_old',
        });
        return;
      }

      const existingActive = usePaymentStatusStore.getState().active;
      const isDuplicate = existingActive?.variant === 'receive' && existingActive.id === quoteId;

      paymentLog.info('hook.payment_status.npc_receive_processing', {
        quoteId,
        mintUrl,
        amount,
        unit,
        isDuplicate,
      });
      usePaymentStatusStore.getState().setActive({
        variant: 'receive',
        id: quoteId,
        mintUrl,
        amount,
        unit,
        state: 'processing',
      });

      if (isDuplicate) {
        paymentLog.info('hook.payment_status.receive_popup_suppressed', {
          quoteId,
          mintUrl,
          reason: 'already_active',
        });
        return;
      }

      paymentStatusPopup({ variant: 'receive', id: quoteId, mintUrl, amount, unit });
    });

    const offRedeemed = manager.on('mint-op:finalized', ({ operationId, operation }) => {
      // FinalizedMintOperation always carries quoteId; init shouldn't reach finalize,
      // but narrow defensively to satisfy the union and keep operationId as a fallback
      // for any future variant that lacks a quoteId.
      const quoteId = operation.state === 'init' ? operationId : operation.quoteId;
      paymentLog.info('hook.payment_status.mint_quote_redeemed', { operationId, quoteId });
      usePaymentStatusStore.getState().setConfirmed(quoteId);
    });

    // The receiveEntryId enrichment used to race a 50ms setTimeout against
    // HistoryService.handleReceiveOperationUpdated. Subscribe to the event
    // instead — `history:updated` fires once the entry is persisted, and
    // we narrow to `state: 'finalized'` so a prepared-state update doesn't
    // confirm the toast prematurely.
    const offHistoryUpdated = manager.on('history:updated', ({ mintUrl, entry }) => {
      if (entry.type !== 'receive' || entry.state !== 'finalized') return;
      const store = usePaymentStatusStore.getState();
      const active = store.active;
      if (
        !active ||
        active.variant !== 'receive-ecash' ||
        active.mintUrl !== mintUrl ||
        active.amount !== amountToNumber(entry.amount) ||
        active.receiveEntryId ||
        !entry.id
      ) {
        return;
      }
      paymentLog.info('hook.payment_status.receive_entry_linked', {
        mintUrl,
        amount: amountToNumber(entry.amount),
        entryId: entry.id,
      });
      store.setConfirmed(active.id, { receiveEntryId: entry.id });
    });

    const offReceiveCreated = manager.on('receive-op:finalized', ({ mintUrl, operation }) => {
      paymentLog.info('hook.payment_status.receive_created', {
        mintUrl,
        amount: amountToNumber(operation.amount),
        operationId: operation.id,
      });
      // Transition the toast to 'confirmed' even if history:updated
      // hasn't fired yet — receiveEntryId may arrive a tick later.
      const store = usePaymentStatusStore.getState();
      const active = store.active;
      if (
        active?.variant === 'receive-ecash' &&
        active.mintUrl === mintUrl &&
        active.amount === amountToNumber(operation.amount)
      ) {
        store.setConfirmed(active.id);
      }
    });

    const offSendFinalized = manager.on('send:finalized', ({ mintUrl, operationId, operation }) => {
      const amount = amountToNumber(operation.amount);
      const unit = 'sat';
      paymentLog.info('hook.payment_status.send_finalized', { operationId, mintUrl, amount });
      if (isSwapStatusActive()) {
        paymentLog.info('hook.payment_status.suppressed_for_swap', {
          operationId,
          mintUrl,
          phase: 'send_finalized',
        });
        return;
      }
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
    });

    const offMeltRolledBack = manager.on('melt-op:rolled-back', ({ operation }) => {
      paymentLog.warn('hook.payment_status.melt_rolled_back', { error: operation.error });
      const store = usePaymentStatusStore.getState();
      if (store.active?.variant === 'melt' && store.active?.state === 'processing') {
        paymentLog.error('hook.payment_status.melt_failed', {
          id: store.active.id,
          error: operation.error,
        });
        store.setFailed(store.active.id, new Error(operation.error ?? 'Payment was rolled back'));
      }
    });

    const offMeltFinalized = manager.on(
      'melt-op:finalized',
      ({ mintUrl, operationId, operation }) => {
        if (!('quoteId' in operation) || !('amount' in operation)) return;
        paymentLog.info('hook.payment_status.melt_finalized', {
          operationId,
          mintUrl,
          quoteId: operation.quoteId,
          amount: amountToNumber(operation.amount),
        });
        if (isSwapStatusActive()) {
          paymentLog.info('hook.payment_status.suppressed_for_swap', {
            operationId,
            mintUrl,
            quoteId: operation.quoteId,
            phase: 'melt_finalized',
          });
          return;
        }
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
          const amount = amountToNumber(operation.amount);
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
      offStateChanged();
      offAdded();
      offRedeemed();
      offHistoryUpdated();
      offReceiveCreated();
      offSendFinalized();
      offMeltRolledBack();
      offMeltFinalized();
    };
  }, [manager]);
}
