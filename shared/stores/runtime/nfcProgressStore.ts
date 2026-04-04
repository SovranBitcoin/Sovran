import { create } from 'zustand';

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
    if (current && (current.status === 'confirmed' || current.status === 'failed')) return;
    set({ active: { phase, status: 'pending' } });
  },
  setConfirmed: () => {
    const current = get().active;
    if (!current || current.status !== 'pending') return;
    set({ active: { ...current, status: 'confirmed' } });
  },
  setFailed: (message) => {
    const current = get().active;
    if (!current || current.status === 'confirmed') return;
    set({ active: { ...current, status: 'failed', errorMessage: message } });
  },
  reset: () => set({ active: null }),
}));
