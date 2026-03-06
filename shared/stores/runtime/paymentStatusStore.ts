import { create } from 'zustand';

import { parsePaymentError } from '@/shared/lib/popup/parsePaymentError';

export type PaymentStatusState = 'processing' | 'confirmed' | 'failed';

export interface ActivePaymentStatus {
  variant: 'receive' | 'send' | 'melt' | 'receive-ecash';
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
  setConfirmed: (id: string, extra?: { operationId?: string; receiveEntryId?: string }) => void;
  setFailed: (id: string, error?: unknown) => void;
};

export const usePaymentStatusStore = create<PaymentStatusStore>((set) => ({
  active: null,
  setActive: (payment) => set({ active: payment }),
  setConfirmed: (id, extra) =>
    set((s) =>
      s.active?.id === id ? { active: { ...s.active!, state: 'confirmed' as const, ...extra } } : s
    ),
  setFailed: (id, error) =>
    set((s) => {
      if (s.active?.id !== id) return s;
      const errorMessage = error !== undefined ? parsePaymentError(error) : undefined;
      return {
        active: { ...s.active!, state: 'failed' as const, errorMessage },
      };
    }),
}));
