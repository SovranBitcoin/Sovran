import { create } from 'zustand';

import { log } from '@/shared/lib/logger';

export type NfcPhase = 'reading' | 'selecting' | 'creating' | 'writing';
export type NfcProgressStatus = 'pending' | 'confirmed' | 'failed';

export interface NfcProgressState {
  phase: NfcPhase;
  status: NfcProgressStatus;
  errorMessage?: string;
}

type NfcProgressStore = {
  active: NfcProgressState | null;
  setPhase: (phase: NfcPhase) => void;
  setConfirmed: () => void;
  setFailed: (message: string) => void;
  reset: () => void;
};

export const useNfcProgressStore = create<NfcProgressStore>((set, get) => ({
  active: null,
  setPhase: (phase) => {
    const current = get().active;
    if (current && (current.status === 'confirmed' || current.status === 'failed')) {
      log.debug('nfc.progress.set_phase.skip', { phase, currentStatus: current.status });
      return;
    }
    log.info('nfc.progress.set_phase', { phase, fromPhase: current?.phase ?? 'none' });
    set({ active: { phase, status: 'pending' } });
  },
  setConfirmed: () => {
    const current = get().active;
    if (!current || current.status !== 'pending') return;
    log.info('nfc.progress.confirmed', { phase: current.phase });
    set({ active: { ...current, status: 'confirmed' } });
  },
  setFailed: (message) => {
    const current = get().active;
    if (!current || current.status === 'confirmed') return;
    log.error('nfc.progress.failed', { phase: current.phase, errorMessage: message });
    set({ active: { ...current, status: 'failed', errorMessage: message } });
  },
  reset: () => {
    log.debug('nfc.progress.reset');
    set({ active: null });
  },
}));
