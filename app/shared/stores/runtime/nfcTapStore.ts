/**
 * Runtime store for the Android tap-to-pay surface.
 *
 * `armed` — the ambient NFC listener is live (wallet focused, NFC on);
 * drives the pulse indicator on the wallet NFC button.
 * `phase` — where the current tap is in its lifecycle; drives the
 * nfc-tap sheet's title/subtitle. Phases past 'reading' come from
 * colada's onNfcPaymentProgress notification ('selecting' today;
 * 'creating'/'writing' once executeNfcSend write-back is wired).
 *
 * Not persisted — listening is per-session and per-screen-focus.
 */

import { create } from 'zustand';
import { paymentLog } from '@/shared/lib/logger';

export type NfcTapPhase = 'armed' | 'reading' | 'selecting' | 'creating' | 'writing';

interface NfcTapStore {
  armed: boolean;
  phase: NfcTapPhase;
  setArmed: (armed: boolean) => void;
  setPhase: (phase: NfcTapPhase) => void;
}

export const useNfcTapStore = create<NfcTapStore>((set) => ({
  armed: false,
  phase: 'armed',
  setArmed: (armed) => {
    paymentLog.info('nfc.tap_store.set_armed', { armed });
    set({ armed });
  },
  setPhase: (phase) => {
    paymentLog.info('nfc.tap_store.set_phase', { phase });
    set({ phase });
  },
}));
