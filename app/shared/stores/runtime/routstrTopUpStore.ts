import { create } from 'zustand';
import { storeLog } from '@/shared/lib/logger';

type RoutstrTopUpResult = 'success' | 'failed';

interface RoutstrTopUpState {
  /** `active` while a Routstr top-up send flow is in progress; `success` /
   *  `failed` once the last attempt has completed; `idle` otherwise. */
  phase: 'idle' | 'active' | RoutstrTopUpResult;
  /** Message text to retry after a successful top-up (set from 402 handler). */
  pendingMessage: string | null;
}

interface RoutstrTopUpActions {
  /** Mark the start of a Routstr top-up flow. */
  start: (pendingMessage?: string | null) => void;
  /** Mark the top-up as complete with a result. */
  complete: (result: RoutstrTopUpResult) => void;
  /** Reset all state (after the chat screen has consumed the result). */
  reset: () => void;
}

export const useRoutstrTopUpStore = create<RoutstrTopUpState & RoutstrTopUpActions>()((set) => ({
  phase: 'idle',
  pendingMessage: null,

  start: (pendingMessage) => {
    storeLog.info('store.routstr_topup.start', { hasPendingMessage: !!pendingMessage });
    set({ phase: 'active', pendingMessage: pendingMessage ?? null });
  },

  complete: (result) => {
    storeLog.info('store.routstr_topup.complete', { result });
    set({ phase: result });
  },

  reset: () => {
    storeLog.debug('store.routstr_topup.reset');
    set({ phase: 'idle', pendingMessage: null });
  },
}));
