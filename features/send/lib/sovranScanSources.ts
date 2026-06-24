/**
 * @fileoverview Sovran scan-input sources for the colada payment machine.
 *
 * The clipboard / photo-gallery / NFC sources the scanner pulls a payment
 * payload from. Each returns a discriminated result ({ data } | { empty } |
 * { canceled } | { error }); NFC distinguishes ambient listening cycles (quiet
 * re-arm) from explicit taps (user-facing popups).
 */
import { scanFromURLAsync } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

import type { NfcIOAdapter, ScanSources } from '@sovranbitcoin/colada';

import { paymentLog } from '@/shared/lib/logger';
import { isAmbientNfcCycle, isUserCancelError, NfcError } from '@/shared/lib/nfc';
import { paramPopup } from '@/shared/lib/popup';
import { decode, isEncoded } from '@/shared/lib/third-party/emoji';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';

export function createSovranScanSources(nfcAdapter?: NfcIOAdapter): ScanSources {
  paymentLog.debug('payment.scan_sources.created', { hasNfc: !!nfcAdapter });
  return {
    clipboard: async () => {
      paymentLog.debug('payment.scan.clipboard.start');
      const rawText = (await Clipboard.getStringAsync()).trim();
      const decodedText = isEncoded(rawText) ? decode(rawText) : rawText;
      if (!decodedText) {
        paymentLog.debug('payment.scan.clipboard.empty');
        return { empty: true };
      }
      paymentLog.info('payment.scan.clipboard.found', { chars: decodedText.length });
      return { data: decodedText };
    },
    gallery: async () => {
      paymentLog.debug('payment.scan.gallery.start');
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 1,
        });

        if (result.canceled || !result.assets?.[0]?.uri) {
          paymentLog.debug('payment.scan.gallery.canceled');
          return { canceled: true };
        }

        const scannedCodes = await scanFromURLAsync(result.assets[0].uri, ['qr']);

        if (scannedCodes.length === 0) {
          paymentLog.debug('payment.scan.gallery.no_qr');
          return { empty: true };
        }

        paymentLog.info('payment.scan.gallery.found', { dataLen: scannedCodes[0].data.length });
        return { data: scannedCodes[0].data };
      } catch (err) {
        paymentLog.error('payment.scan.gallery.failed', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        return { error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    nfc: nfcAdapter
      ? async () => {
          // Ambient cycles (wallet-screen listening loop) re-arm every ~30s,
          // so their per-cycle failures must stay quiet; explicit presses
          // keep the popups.
          const ambient = isAmbientNfcCycle();
          const closeTapSheet = () => {
            const popup = usePopupStore.getState();
            if (
              popup.current &&
              'sheetId' in popup.current &&
              popup.current.sheetId === 'nfc-tap'
            ) {
              popup.close();
            }
          };
          try {
            const data = await nfcAdapter.readPaymentRequest();
            // The flow navigates to the payment screen now — don't leave the
            // tap sheet floating over it.
            closeTapSheet();
            return { data };
          } catch (err) {
            // User dismissed the system NFC sheet — treat as a no-op,
            // not an error (suppresses the `general-error` popup).
            if (isUserCancelError(err)) return { empty: true };
            // Preflight failures from acquireSession get their own popups —
            // before this, an Android tap with NFC off hung forever silently.
            if (err instanceof NfcError && err.code === 'NOT_ENABLED') {
              if (!ambient) {
                paramPopup('nfc-error', {
                  title: 'NFC is turned off',
                  message: 'Turn on NFC in system settings to scan.',
                });
              }
              return { empty: true };
            }
            if (err instanceof NfcError && err.code === 'NOT_SUPPORTED') {
              if (!ambient) {
                paramPopup('nfc-error', {
                  title: 'NFC not supported',
                  message: 'This device has no NFC hardware.',
                });
              }
              return { empty: true };
            }
            if (err instanceof NfcError && err.code === 'TIMEOUT') {
              // Nothing was tapped within the window — quiet no-op.
              return { empty: true };
            }
            if (ambient) {
              // A garbled ambient read (non-payment tag, partial APDU) must
              // not surface the general-error popup; the loop just re-arms.
              paymentLog.debug('nfc.ambient.read_failed', {
                error: err instanceof Error ? err.message : String(err),
              });
              return { empty: true };
            }
            return { error: err instanceof Error ? err : new Error(String(err)) };
          } finally {
            // Timeouts deliberately leave the sheet up: the ambient loop
            // re-arms immediately and the sheet should read as continuous
            // listening, not blink every 30s. Error popups replace the sheet
            // through the popup store; the success path closed it above.
            useNfcTapStore.getState().setPhase('armed');
          }
        }
      : undefined,
  };
}
