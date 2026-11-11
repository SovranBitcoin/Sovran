/**
 * Runtime store for the Android tap-to-pay surface.
 *
 * `armed` — the ambient NFC listener is live (wallet focused, NFC on);
 * drives the pulse indicator on the wallet NFC button.
 * `phase` — where the current tap is in its lifecycle; drives the
 * nfc-tap sheet's title/subtitle. Phases past 'reading' come from
 * colada's onNfcPaymentProgress notification ('selecting', then
 * 'creating' and 'writing' during the NFC write-back).
 *
 * Not persisted — listening is per-session and per-screen-focus.
 */

import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { paymentLog } from '@/shared/lib/logger';

export type NfcTapPhase = 'armed' | 'reading' | 'selecting' | 'creating' | 'writing';

interface NfcTapStore {
  armed: boolean;
  phase: NfcTapPhase;
  setArmed: (armed: boolean) => void;
  setPhase: (phase: NfcTapPhase) => void;
}

export const useNfcTapStore = create<NfcTapStore>({ name: 'useNfcTapStore', scope: 'session' })(
  (set) => ({
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
  })
);
