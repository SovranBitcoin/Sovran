import { create } from 'zustand';

import { describeError } from '@/shared/lib/errors';
import { paymentLog } from '@/shared/lib/logger';

type PaymentStatusState = 'processing' | 'delivered' | 'waiting' | 'confirmed' | 'failed';

interface ActivePaymentStatus {
  variant: 'receive' | 'send' | 'melt' | 'receive-ecash' | 'payment-request';
  /** quoteId (receive) or operationId (send) or receiveHistoryEntry.id (receive-ecash) */
  id: string;
  mintUrl: string;
  amount: number;
  unit: string;
  state: PaymentStatusState;
  /** For melt: set when melt-op:finalized fires, used for View button */
  operationId?: string;
  /** For receive-ecash: set when receive:created fires, used for View button */
  receiveEntryId?: string;
  /** User-friendly reason when state is 'failed' */
  errorMessage?: string;
  /** Optional title override while the payment is still pending. */
  titleOverride?: string;
  /** Optional subtitle override while the payment is still pending. */
  subtitleOverride?: string;
}

type PaymentStatusStore = {
  active: ActivePaymentStatus | null;
  setActive: (payment: ActivePaymentStatus | null) => void;
  clearActive: (id?: string) => void;
  setWaiting: (id: string, copy: { title: string; subtitle: string }) => void;
  setDelivered: (id: string) => void;
  setConfirmed: (id: string, extra?: { operationId?: string; receiveEntryId?: string }) => void;
  setFailed: (id: string, error?: unknown) => void;
};

/** Debug-log a refused transition; call sites keep their literal event keys. */
function logSkip(
  event: string,
  s: { active: ActivePaymentStatus | null },
  requestedId: string,
  reason: string
): void {
  paymentLog.debug(event, {
    requestedId,
    activeId: s.active?.id ?? null,
    activeState: s.active?.state ?? null,
    reason,
  });
}

function withoutStatusCopy(active: ActivePaymentStatus): ActivePaymentStatus {
  const next = { ...active };
  delete next.titleOverride;
  delete next.subtitleOverride;
  return next;
}

export const usePaymentStatusStore = create<PaymentStatusStore>((set) => ({
  active: null,
  setActive: (payment) => {
    set((s) => {
      paymentLog.info(
        'payment.status.set_active',
        payment
          ? {
              variant: payment.variant,
              id: payment.id,
              state: payment.state,
              amount: payment.amount,
              unit: payment.unit,
              previousId: s.active?.id ?? null,
              previousState: s.active?.state ?? null,
            }
          : {
              cleared: true,
              previousId: s.active?.id ?? null,
              previousState: s.active?.state ?? null,
            }
      );
      return { active: payment };
    });
  },
  clearActive: (id) =>
    set((s) => {
      if (id !== undefined && s.active?.id !== id) {
        logSkip('payment.status.clear_active.skipped', s, id, 'id_mismatch');
        return s;
      }
      paymentLog.info('payment.status.clear_active', {
        id: s.active?.id ?? null,
        from: s.active?.state ?? null,
        requestedId: id ?? null,
      });
      return { active: null };
    }),
  setWaiting: (id, copy) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.waiting.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (s.active.state === 'confirmed' || s.active.state === 'failed') {
        logSkip('payment.status.waiting.skipped', s, id, 'terminal_state');
        return s;
      }
      paymentLog.info('payment.status.waiting', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'waiting',
        expectedNext: 'terminal_warning_toast_then_later_success_toast',
      });
      return {
        active: {
          ...s.active,
          state: 'waiting' as const,
          titleOverride: copy.title,
          subtitleOverride: copy.subtitle,
        },
      };
    }),
  setDelivered: (id) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.delivered.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (
        s.active.state === 'waiting' ||
        s.active.state === 'confirmed' ||
        s.active.state === 'failed'
      ) {
        logSkip('payment.status.delivered.skipped', s, id, 'terminal_or_waiting_state');
        return s;
      }
      paymentLog.info('payment.status.delivered', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'delivered',
      });
      return { active: { ...s.active, state: 'delivered' as const } };
    }),
  setConfirmed: (id, extra) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.confirmed.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (s.active.state === 'confirmed') {
        // Already confirmed — only merge extra data (operationId, receiveEntryId)
        paymentLog.debug('payment.status.confirmed.merge_extra', { id, hasExtra: !!extra });
        return extra ? { active: { ...s.active!, ...extra } } : s;
      }
      if (s.active.state === 'waiting') {
        paymentLog.debug('payment.status.confirmed.skip_waiting', { id });
        return s;
      }
      if (s.active.state === 'failed') {
        paymentLog.debug('payment.status.confirmed.skip_failed', { id });
        return s;
      }
      paymentLog.info('payment.status.confirmed', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'confirmed',
        hasOperationId: !!extra?.operationId,
        hasReceiveEntryId: !!extra?.receiveEntryId,
      });
      return {
        active: { ...withoutStatusCopy(s.active!), state: 'confirmed' as const, ...extra },
      };
    }),
  setFailed: (id, error) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.failed.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (
        s.active.state === 'waiting' ||
        s.active.state === 'failed' ||
        s.active.state === 'confirmed'
      ) {
        logSkip('payment.status.failed.skipped', s, id, 'terminal_or_waiting_state');
        return s;
      }
      const errorMessage = error !== undefined ? describeError(error, 'cashu').text : undefined;
      paymentLog.error('payment.status.failed', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'failed',
        errorMessage,
      });
      return {
        active: { ...withoutStatusCopy(s.active!), state: 'failed' as const, errorMessage },
      };
    }),
}));
