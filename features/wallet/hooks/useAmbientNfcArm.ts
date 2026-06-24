/**
 * Ambient Android tap-to-pay: while the wallet screen is focused (and NFC is
 * supported + enabled), keep an NFC read armed in a re-arming loop so the
 * user can tap a payment terminal without pressing anything. The hybrid UX
 * (user decision): listening is "technically always on"; the NFC button just
 * surfaces the tap-to-pay sheet, and an ambient tag arrival auto-opens it.
 *
 * Safety: a successful read enters colada's NORMAL navigation flow (no
 * executeNfcSend operation is wired), so every payment still lands on the
 * app's own review/pay screen — ambient listening can't move money by
 * itself. Do not wire executeNfcSend auto-execution without revisiting this.
 *
 * Lifecycle: useFocusEffect — arming stops the moment the wallet blurs
 * (navigating into any flow, backgrounding via blur) and the held native
 * session is cancelled, so other NFC apps and flows are unaffected. Each
 * cycle is one machine.scan(source: 'nfc') call: it times out quietly after
 * 30s (suppressed by the ambient flag in the nfc scan source) and re-arms.
 */

import { useRef } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  isNfcEnabled,
  isNfcSupported,
  releaseSession,
  setAmbientNfcCycle,
  setNfcTagConnectedListener,
} from '@/shared/lib/nfc';
import { showActionSheet } from '@/shared/lib/popup';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { walletLog } from '@/shared/lib/logger';

/** Pause between re-arm cycles; also the NFC-disabled re-check interval. */
const REARM_DELAY_MS = 600;
const DISABLED_RECHECK_MS = 4000;
/** Re-check interval while paused under a non-nfc popup (payment sheets). */
const POPUP_RECHECK_MS = 1500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface AmbientNfcMachine {
  scan?: (data?: undefined, opts?: { source: 'nfc' }) => Promise<unknown> | unknown;
}

export function useAmbientNfcArm(machine: AmbientNfcMachine): void {
  // The machine object identity changes across renders; the loop reads the
  // latest through a ref so focus/blur is the only thing that restarts it.
  const machineRef = useRef(machine);
  machineRef.current = machine;

  useFocusEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    // Dismissal is sticky: once the user swipes the nfc-tap sheet away,
    // the tag-connected listener must NOT re-surface it on the next tag
    // arrival (an NFC card resting against the phone would re-open it
    // ~1.2s after every dismissal, mid-exit-animation). Cleared when the
    // sheet is shown again (explicit button press) or the loop restarts.
    let userDismissedSheet = false;
    const { setArmed, setPhase } = useNfcTapStore.getState();

    const unsubscribePopup = usePopupStore.subscribe((state, prev) => {
      const wasTapSheet =
        prev.current != null && 'sheetId' in prev.current && prev.current.sheetId === 'nfc-tap';
      const isTapSheet =
        state.current != null && 'sheetId' in state.current && state.current.sheetId === 'nfc-tap';
      if (wasTapSheet && state.current == null) userDismissedSheet = true;
      if (isTapSheet) userDismissedSheet = false;
    });

    // A tag entered the field: flip the sheet to 'Reading' and surface it
    // if nothing else is showing (ambient tap with the sheet closed) and
    // the user hasn't dismissed it this focus session.
    setNfcTagConnectedListener(() => {
      if (!active) return;
      useNfcTapStore.getState().setPhase('reading');
      if (!userDismissedSheet && usePopupStore.getState().current == null) {
        showActionSheet('nfc-tap', {});
      }
    });

    const loop = async () => {
      if (!(await isNfcSupported())) return;
      walletLog.info('wallet.nfc.ambient_arm_start');
      while (active) {
        if (!(await isNfcEnabled())) {
          useNfcTapStore.getState().setArmed(false);
          await delay(DISABLED_RECHECK_MS);
          continue;
        }
        // Popup-lane payment surfaces (payment-options, proof-selector,
        // send-memo) are NOT routes — the wallet stays focused beneath
        // them, so without this guard the loop would keep cycling and its
        // clearPaymentContext would wipe the amount draft mid-flow every
        // ~31s. Pause (no clear, no scan) while any popup other than our
        // own tap sheet is up.
        const popupCurrent = usePopupStore.getState().current;
        const popupBlocks =
          popupCurrent != null &&
          !('sheetId' in popupCurrent && popupCurrent.sheetId === 'nfc-tap');
        if (popupBlocks) {
          await delay(POPUP_RECHECK_MS);
          continue;
        }
        setArmed(true);
        setAmbientNfcCycle(true);
        // Root-entry reset (sovran-payment-flow-guards): wallet focused +
        // no payment popup up means no flow is active, so clearing stale
        // amount/mint context before a read can enter the machine is safe.
        clearPaymentContext('wallet.nfc_ambient');
        try {
          await machineRef.current.scan?.(undefined, { source: 'nfc' });
        } catch (err) {
          walletLog.debug('wallet.nfc.ambient_cycle_error', {
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setAmbientNfcCycle(false);
        }
        if (!active) break;
        await delay(REARM_DELAY_MS);
      }
    };
    void loop();

    return () => {
      active = false;
      unsubscribePopup();
      setNfcTagConnectedListener(null);
      useNfcTapStore.getState().setArmed(false);
      setPhase('armed');
      // Don't leave a sheet claiming "listening" after the listener is
      // gone (e.g. navigating away with the sheet up).
      const popup = usePopupStore.getState();
      if (popup.current && 'sheetId' in popup.current && popup.current.sheetId === 'nfc-tap') {
        popup.close();
      }
      // Cancel the held requestTechnology so the pending cycle resolves
      // (as a quiet user-cancel) instead of dangling for up to 30s.
      void releaseSession();
      walletLog.info('wallet.nfc.ambient_arm_stop');
    };
  });
}
