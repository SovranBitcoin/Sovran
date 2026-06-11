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

import { useCallback, useRef } from 'react';
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

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface AmbientNfcMachine {
  scan?: (data?: undefined, opts?: { source: 'nfc' }) => Promise<unknown> | unknown;
}

export function useAmbientNfcArm(machine: AmbientNfcMachine): void {
  // The machine object identity changes across renders; the loop reads the
  // latest through a ref so focus/blur is the only thing that restarts it.
  const machineRef = useRef(machine);
  machineRef.current = machine;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      let active = true;
      const { setArmed, setPhase } = useNfcTapStore.getState();

      // A tag entered the field: flip the sheet to 'Reading' and surface it
      // if nothing else is showing (ambient tap with the sheet closed).
      setNfcTagConnectedListener(() => {
        if (!active) return;
        useNfcTapStore.getState().setPhase('reading');
        if (usePopupStore.getState().current == null) {
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
          setArmed(true);
          setAmbientNfcCycle(true);
          // Root-entry reset (sovran-payment-flow-guards): the wallet being
          // focused means no payment flow is active, so clearing stale
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
        setNfcTagConnectedListener(null);
        useNfcTapStore.getState().setArmed(false);
        setPhase('armed');
        // Cancel the held requestTechnology so the pending cycle resolves
        // (as a quiet user-cancel) instead of dangling for up to 30s.
        void releaseSession();
        walletLog.info('wallet.nfc.ambient_arm_stop');
      };
    }, [])
  );
}
