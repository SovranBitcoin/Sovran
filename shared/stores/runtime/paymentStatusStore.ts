import { create } from 'zustand';

import { parsePaymentError } from '@/shared/lib/popup/parsePaymentError';
import { log } from '@/shared/lib/logger';

export type PaymentStatusState = 'processing' | 'delivered' | 'confirmed' | 'failed';

export interface ActivePaymentStatus {
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
}

type PaymentStatusStore = {
  active: ActivePaymentStatus | null;
  setActive: (payment: ActivePaymentStatus | null) => void;
  setDelivered: (id: string) => void;
  setConfirmed: (id: string, extra?: { operationId?: string; receiveEntryId?: string }) => void;
  setFailed: (id: string, error?: unknown) => void;
};

export const usePaymentStatusStore = create<PaymentStatusStore>((set) => ({
  active: null,
  setActive: (payment) => {
    log.info('payment.status.set_active', payment ? { variant: payment.variant, id: payment.id, state: payment.state, amount: payment.amount, unit: payment.unit } : { cleared: true });
    set({ active: payment });
  },
  setDelivered: (id) =>
    set((s) => {
      if (s.active?.id === id) {
        log.info('payment.status.delivered', { id, variant: s.active.variant, from: s.active.state });
        return { active: { ...s.active!, state: 'delivered' as const } };
      }
      return s;
    }),
  setConfirmed: (id, extra) =>
    set((s) => {
      if (s.active?.id !== id) return s;
      if (s.active.state === 'confirmed') {
        // Already confirmed — only merge extra data (operationId, receiveEntryId)
        log.debug('payment.status.confirmed.merge_extra', { id, hasExtra: !!extra });
        return extra ? { active: { ...s.active!, ...extra } } : s;
      }
      if (s.active.state === 'failed') {
        log.debug('payment.status.confirmed.skip_failed', { id });
        return s;
      }
      log.info('payment.status.confirmed', { id, variant: s.active.variant, from: s.active.state, hasOperationId: !!extra?.operationId, hasReceiveEntryId: !!extra?.receiveEntryId });
      return { active: { ...s.active!, state: 'confirmed' as const, ...extra } };
    }),
  setFailed: (id, error) =>
    set((s) => {
      if (s.active?.id !== id || s.active.state === 'failed' || s.active.state === 'confirmed')
        return s;
      const errorMessage = error !== undefined ? parsePaymentError(error) : undefined;
      log.error('payment.status.failed', { id, variant: s.active.variant, from: s.active.state, errorMessage });
      return {
        active: { ...s.active!, state: 'failed' as const, errorMessage },
      };
    }),
}));
