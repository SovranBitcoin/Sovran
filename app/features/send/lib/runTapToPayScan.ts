/**
 * Explicit "Tap to pay" press. iOS shows its system "Ready to Scan" sheet for
 * the NFC read; Android has none, and the Send modal blurs the wallet screen
 * so the ambient listener (useAmbientNfcArm) is already stopped. Without this
 * the press started an invisible 30s read and looked dead.
 *
 * On Android this mirrors the iOS sheet: surface the nfc-tap sheet, flip it to
 * 'Reading' when a tag connects, and keep listening until the sheet goes away
 * (success closes it, an error popup replaces it, the user closes it). Like
 * Minibits and the native Cashu wallet, a quiet read timeout re-arms rather
 * than ending the session. Closing the sheet cancels the read only before any
 * ecash is created — cancelling mid-write could spend without delivering.
 */

import { Platform } from 'react-native';

import { releaseSession, setNfcTagConnectedListener } from '@/shared/lib/nfc';
import { showActionSheet } from '@/shared/lib/popup';
import { paymentLog } from '@/shared/lib/logger';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';

type PopupCurrent = ReturnType<typeof usePopupStore.getState>['current'];

const isTapSheet = (current: PopupCurrent) =>
  current != null && 'sheetId' in current && current.sheetId === 'nfc-tap';

/** Pause between re-arms, matching the ambient loop; keeps a fast-failing read from spinning. */
const REARM_DELAY_MS = 600;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const tapSheetOpen = () => isTapSheet(usePopupStore.getState().current);

export async function runTapToPayScan(scan: () => Promise<unknown> | unknown): Promise<void> {
  if (Platform.OS !== 'android') {
    await scan();
    return;
  }

  let listening = true;
  useNfcTapStore.getState().setPhase('armed');
  setNfcTagConnectedListener(() => {
    if (listening) useNfcTapStore.getState().setPhase('reading');
  });
  const unsubscribePopup = usePopupStore.subscribe((state, prev) => {
    if (!listening || !isTapSheet(prev.current) || state.current != null) return;
    const { phase } = useNfcTapStore.getState();
    paymentLog.info('send.nfc.tap_sheet_dismissed', { phase });
    if (phase !== 'creating' && phase !== 'writing') void releaseSession();
  });
  showActionSheet('nfc-tap', {});

  try {
    await scan();
    while (tapSheetOpen()) {
      await delay(REARM_DELAY_MS);
      if (!tapSheetOpen()) break;
      await scan();
    }
  } finally {
    listening = false;
    unsubscribePopup();
    setNfcTagConnectedListener(null);
    useNfcTapStore.getState().setPhase('armed');
  }
}
