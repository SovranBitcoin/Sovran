import { create } from 'zustand';
import { storeLog } from '@/shared/lib/logger';

interface RoutstrTopUpState {
  /** True while a Routstr top-up send flow is in progress. */
  active: boolean;
  /** Message text to retry after a successful top-up (set from 402 handler). */
  pendingMessage: string | null;
  /** Result of the last completed top-up attempt. */
  lastResult: 'success' | 'failed' | null;
}

interface RoutstrTopUpActions {
  /** Mark the start of a Routstr top-up flow. */
  start: (pendingMessage?: string | null) => void;
  /** Mark the top-up as complete with a result. */
  complete: (result: 'success' | 'failed') => void;
  /** Reset all state (after the chat screen has consumed the result). */
  reset: () => void;
}

export const useRoutstrTopUpStore = create<RoutstrTopUpState & RoutstrTopUpActions>()((set) => ({
  active: false,
  pendingMessage: null,
  lastResult: null,

  start: (pendingMessage) => {
    storeLog.info('store.routstr_topup.start', { hasPendingMessage: !!pendingMessage });
    set({ active: true, pendingMessage: pendingMessage ?? null, lastResult: null });
  },

  complete: (result) => {
    storeLog.info('store.routstr_topup.complete', { result });
    set({ active: false, lastResult: result });
  },

  reset: () => {
    storeLog.debug('store.routstr_topup.reset');
    set({ active: false, pendingMessage: null, lastResult: null });
  },
}));
