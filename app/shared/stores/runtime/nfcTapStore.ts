/**
 * Runtime store for the Android tap-to-pay surface.
 *
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
  phase: NfcTapPhase;
  setPhase: (phase: NfcTapPhase) => void;
}

export const useNfcTapStore = create<NfcTapStore>({ name: 'useNfcTapStore', scope: 'session' })(
  (set) => ({
    phase: 'armed',
    setPhase: (phase) => {
      paymentLog.info('nfc.tap_store.set_phase', { phase });
      set({ phase });
    },
  })
);
