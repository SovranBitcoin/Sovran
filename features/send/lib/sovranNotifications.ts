/**
 * @fileoverview Sovran notification handlers for the colada payment machine.
 *
 * Maps colada payment-machine notification codes to Sovran UI (popups, toasts,
 * payment-status store updates) and side effects (P2PK key refresh, location
 * capture, scan-history linking). One handler per notification code.
 */
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { paymentLog } from '@/shared/lib/logger';
import { mintUrlLogFields } from './sovranPaymentLog';

import type { Manager } from '@cashu/coco-core';
import {
  isSendTokenCancelled,
  isSendTokenComplete,
  type NotificationHandlerMap,
  rawAnnotationKey,
} from '@sovranbitcoin/colada';

import { getP2PKImportExtension } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import {
  copyPopup,
  paymentCancelledPopup,
  paymentStatusPopup,
  staticPopup,
  paramPopup,
} from '@/shared/lib/popup';
import { RECEIVE_PENDING_TOAST_COPY } from '@/shared/lib/popup/paymentStatusCopy';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import {
  linkTransactionAnnotation,
  setTransactionAnnotation,
} from '@/shared/stores/profile/transactionAnnotationStore';

interface CreateSovranNotificationsConfig {
  getPubkey?: () => string | undefined;
  getPrivateKey?: () => Uint8Array | undefined;
  getManager?: () => Manager | null;
  onP2pkKeyRefreshed?: (newPublicKeyHex: string | null) => void;
}

export function createSovranNotifications(
  config?: CreateSovranNotificationsConfig
): NotificationHandlerMap {
  paymentLog.debug('payment.notifications.created');
  return {
    NO_AMOUNT: ({ code: _code, message: _message, data: _data }) => {
      paymentLog.warn('payment.notification.no_amount');
      staticPopup('no-amount');
    },
    NO_VALID_MINT: ({ code: _code, message, data: _data }) => {
      staticPopup('no-valid-mint', { text: message });
    },
    INSUFFICIENT_BALANCE: ({ code: _code, message, data: _data }) => {
      staticPopup('balance-too-low', { text: message });
    },
    NO_BALANCE: ({ code: _code, message, data: _data }) => {
      staticPopup('balance-too-low', { text: message });
    },
    UNSUPPORTED_INPUT: ({ code: _code, message, data: _data }) => {
      staticPopup('unsupported-input', { text: message });
    },
    UNSUPPORTED_PAYMENT_METHOD: ({ code: _code, message, data: _data }) => {
      staticPopup('unsupported-payment-method', { text: message });
    },
    ALL_OPTIONS_DISABLED: ({ code: _code, message: _message, data: _data }) => {
      staticPopup('all-options-disabled');
    },
    MISSING_MELT_TARGET: ({ code: _code, message: _message, data: _data }) => {
      staticPopup('missing-melt-target');
    },
    SEND_FAILED: ({ code: _code, message, data }) => {
      paymentLog.error('payment.notification.send_failed', { message });
      if (data?.mintUnreachable) {
        staticPopup('mint-unreachable');
      } else {
        staticPopup('general-error', { text: message });
      }
    },
    MINT_QUOTE_FAILED: ({ code: _code, message, data }) => {
      if (data?.mintUnreachable) {
        staticPopup('mint-unreachable');
      } else {
        staticPopup('general-error', { text: message });
      }
    },
    MELT_FAILED: ({ code: _code, message, data }) => {
      paymentLog.error('payment.notification.melt_failed', { message });
      if (data?.mintUnreachable) {
        staticPopup('mint-unreachable');
      } else {
        staticPopup('general-error', { text: message });
      }
    },
    PAYMENT_REQUEST_FAILED: ({ code: _code, message, data: _data }) => {
      staticPopup('send-payment-failed', { text: message });
    },
    NFC_WRITE_FAILED: ({ code: _code, message, data: _data }) => {
      paramPopup('nfc-error', { title: 'NFC Write Failed', message });
    },
    NFC_SESSION_LOST: ({ code: _code, message, data: _data }) => {
      paramPopup('nfc-error', { title: 'NFC Connection Lost', message });
    },
    NFC_READ_FAILED: ({ code: _code, message, data: _data }) => {
      paramPopup('nfc-error', { title: 'NFC Read Failed', message });
    },
    onPaymentProcessing: (data) => {
      const store = usePaymentStatusStore.getState();
      const variant = data.variant === 'paymentRequest' ? 'payment-request' : data.variant;
      const id = `${data.variant}-${Date.now()}`;
      paymentLog.info('payment.processing', {
        variant: data.variant,
        statusVariant: variant,
        id,
        ...mintUrlLogFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        activeId: store.active?.id ?? null,
        activeState: store.active?.state ?? null,
        expectedNext: 'processing_to_terminal_or_delivered',
      });
      store.setActive({
        variant,
        id,
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        state: 'processing',
      });
      paymentStatusPopup({
        variant,
        id,
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
      });
    },
    onPaymentConfirmed: (data) => {
      const store = usePaymentStatusStore.getState();
      paymentLog.info('payment.confirmed', {
        variant: data.variant,
        ...mintUrlLogFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        activeId: store.active?.id ?? null,
        activeState: store.active?.state ?? null,
        historyEntryLength: data.historyEntry.length,
      });
      if (!store.active) {
        paymentLog.warn('payment.confirmed.skipped', {
          variant: data.variant,
          reason: 'no_active_status_toast',
        });
        return;
      }

      if (data.variant === 'paymentRequest') {
        paymentLog.info('payment.confirmed.route', {
          variant: data.variant,
          action: 'set_delivered',
          activeId: store.active.id,
          activeState: store.active.state,
          expectedNext: 'delivered_then_later_confirmed',
        });
        store.setDelivered(store.active.id);
      } else if (data.variant === 'melt' && data.historyEntry) {
        try {
          const parsed = JSON.parse(data.historyEntry);
          if (parsed.state === 'PENDING') {
            paymentLog.info('payment.confirmed.skipped', {
              variant: data.variant,
              reason: 'melt_history_pending',
              activeId: store.active.id,
              activeState: store.active.state,
            });
            return;
          }
        } catch (error) {
          paymentLog.warn('payment.confirmed.history_parse_failed', {
            variant: data.variant,
            historyEntryLength: data.historyEntry.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        paymentLog.info('payment.confirmed.route', {
          variant: data.variant,
          action: 'set_confirmed',
          activeId: store.active.id,
          activeState: store.active.state,
        });
        store.setConfirmed(store.active.id);
      } else {
        paymentLog.info('payment.confirmed.route', {
          variant: data.variant,
          action: 'set_confirmed',
          activeId: store.active.id,
          activeState: store.active.state,
        });
        store.setConfirmed(store.active.id);
      }
    },
    onPaymentFailed: (data) => {
      const store = usePaymentStatusStore.getState();
      paymentLog.error('payment.failed', {
        variant: data.variant,
        ...mintUrlLogFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        message: data.message,
        rolledBack: data.rolledBack,
        activeId: store.active?.id ?? null,
        activeState: store.active?.state ?? null,
      });
      if (!store.active) {
        paymentLog.warn('payment.failed.skipped', {
          variant: data.variant,
          reason: 'no_active_status_toast',
        });
        return;
      }
      const msg = data.rolledBack
        ? `${data.message}\nYour funds have been returned.`
        : data.message;
      paymentLog.info('payment.failed.route', {
        variant: data.variant,
        action: 'set_failed',
        activeId: store.active.id,
        activeState: store.active.state,
        rolledBack: data.rolledBack,
      });
      store.setFailed(store.active.id, new Error(msg));
    },
    onScanEmpty: (source) => {
      if (source === 'clipboard') staticPopup('no-clipboard-address');
      else if (source === 'gallery') staticPopup('no-qr-code-found');
    },
    onScanError: (source, err) => {
      if (source === 'gallery') staticPopup('qr-scan-failed');
      else staticPopup('general-error', { text: err.message });
    },
    onMissingMintForAmount: () => {
      staticPopup('no-mint-selected');
    },
    onCopied: (target) => {
      copyPopup(target as Parameters<typeof copyPopup>[0]);
    },
    onScanResolved: ({ rawInput, parsedType, intentType, source, container, optionKinds }) => {
      const typeMap: Record<
        string,
        'ecash' | 'lightning' | 'npub' | 'mint' | 'paymentRequest' | 'unknown'
      > = {
        receiveToken: 'ecash',
        meltLightningInvoice: 'lightning',
        meltLightningAddress: 'lightning',
        meltLnurlp: 'lightning',
        sendPaymentRequest: 'paymentRequest',
        openMint: 'mint',
        openProfile: 'npub',
      };
      const scanType = typeMap[intentType] ?? 'unknown';
      const sourceMap: Record<string, 'qr' | 'nfc' | 'paste' | 'deeplink'> = {
        clipboard: 'paste',
        gallery: 'qr',
        qr: 'qr',
        nfc: 'nfc',
        deeplink: 'deeplink',
      };
      const scanSource = sourceMap[source ?? ''] ?? 'qr';
      useScanHistoryStore
        .getState()
        .addScan(rawInput, scanType, scanSource, parsedType, container, optionKinds);
      // Annotation: stash the scan under a raw key now; bridged onto the final
      // transaction id in onTransactionCreated (colada owns the read model).
      setTransactionAnnotation(rawAnnotationKey(rawInput), {
        scan: {
          method: scanSource,
          raw: rawInput,
          container,
          optionKinds,
          inputType: parsedType,
        },
      });
    },
    onNfcWriteFailed: ({ message, rolledBack }) => {
      const errorMsg = rolledBack ? `${message} Your funds have been returned.` : message;
      paramPopup('nfc-error', { title: 'NFC Write Failed', message: errorMsg });
    },
    // Drives the Android tap-to-pay sheet's phase text ('Preparing payment…'
    // etc.). 'creating'/'writing' only fire once executeNfcSend write-back
    // is wired; harmless to map them now.
    onNfcPaymentProgress: ({ phase }) => {
      useNfcTapStore.getState().setPhase(phase);
    },

    // ── Screen action notifications ─────────────────────────────────

    onSendStatusChecked: ({ operationId: _operationId, state, redeemed }) => {
      if (redeemed || isSendTokenComplete({ state })) {
        staticPopup('token-redeemed-by-recipient');
      } else if (isSendTokenCancelled({ state })) {
        staticPopup('transaction-already-cancelled');
      } else if (state === 'not_found') {
        staticPopup('operation-not-found');
      } else if (state !== 'pending') {
        paramPopup('operation-invalid-state', { state });
      } else {
        staticPopup('token-pending-not-redeemed');
      }
    },

    onSendCancelled: (_data) => {
      staticPopup('transaction-cancelled');
    },

    onSendCancelFailed: ({ message, mintUnreachable, offline }) => {
      if (offline) {
        staticPopup('cancel-transaction-offline');
      } else if (mintUnreachable) {
        staticPopup('mint-unreachable');
      } else {
        staticPopup('cancel-transaction-failed', { text: message });
      }
    },

    onReceiveProcessing: ({ id, mintUrl, amount, unit }) => {
      const store = usePaymentStatusStore.getState();
      paymentLog.info('payment.receive.processing', {
        id,
        ...mintUrlLogFields(mintUrl),
        amount,
        unit,
        activeId: store.active?.id ?? null,
        activeState: store.active?.state ?? null,
        expectedNext: 'processing_to_confirmed_or_waiting_or_failed',
      });
      if (store.active?.id === id && store.active?.state === 'failed') {
        store.setActive(null);
      }
      store.setActive({
        variant: 'receive-ecash',
        id,
        mintUrl,
        amount,
        unit,
        state: 'processing',
      });
      paymentStatusPopup({
        variant: 'receive-ecash',
        id,
        mintUrl,
        amount,
        unit,
      });
    },

    onReceivePending: ({ id, mintUrl, amount, unit, operationId, message }) => {
      const store = usePaymentStatusStore.getState();
      const wasActive = store.active?.id === id;
      paymentLog.info('payment.receive.pending', {
        id,
        ...mintUrlLogFields(mintUrl),
        amount,
        unit,
        operationId,
        activeId: store.active?.id ?? null,
        activeState: store.active?.state ?? null,
        wasActive,
        toastPolicy: 'terminal_warning_then_new_success',
        expectedNext: 'coco_recovery_then_success_toast',
      });
      if (!wasActive) {
        store.setActive({
          variant: 'receive-ecash',
          id,
          mintUrl,
          amount,
          unit,
          state: 'processing',
        });
        paymentStatusPopup({
          variant: 'receive-ecash',
          id,
          mintUrl,
          amount,
          unit,
        });
      }
      store.setWaiting(id, {
        title: RECEIVE_PENDING_TOAST_COPY.title,
        subtitle: message ?? RECEIVE_PENDING_TOAST_COPY.subtitle,
      });
    },

    onReceiveConfirmed: async ({ id, historyEntry }) => {
      const store = usePaymentStatusStore.getState();
      paymentLog.info('payment.receive.confirmed', {
        id,
        activeId: store.active?.id ?? null,
        activeState: store.active?.state ?? null,
        expectedNext:
          store.active?.state === 'waiting'
            ? 'listener_mounts_new_success_toast'
            : 'active_toast_confirmed',
      });
      if (store.active?.id === id) {
        store.setConfirmed(id);
      }
      try {
        const entry = JSON.parse(historyEntry);
        if (entry.id) {
          await captureAndStoreLocation(entry.id);
        }
      } catch {
        // Non-critical — skip location capture
      }
    },

    onReceiveFailed: ({ id, message }) => {
      const store = usePaymentStatusStore.getState();
      paymentLog.error('payment.receive.failed', {
        id,
        message,
        activeId: store.active?.id ?? null,
        activeState: store.active?.state ?? null,
        expectedNext:
          store.active?.id === id && store.active?.state === 'processing'
            ? 'active_toast_failed'
            : 'static_receive_failed_popup',
      });
      if (store.active?.id === id && store.active?.state === 'processing') {
        store.setFailed(id, new Error(message));
      } else {
        staticPopup('receive-failed', { text: message });
      }
    },

    onMeltCancelled: (_data) => {
      paymentCancelledPopup();
    },

    onMeltCancelFailed: ({ message, mintUnreachable }) => {
      if (mintUnreachable) {
        staticPopup('mint-unreachable');
      } else {
        staticPopup('could-not-cancel', { text: message });
      }
    },

    onUnsupportedTokenUnit: ({ unit }) => {
      paramPopup('unsupported-token-unit', { unit });
    },

    onMintTrustedFromScreen: ({ fromAccepter }) => {
      if (fromAccepter) {
        router.dismiss();
      } else {
        router.back();
      }
    },

    // ── State change notifications ──────────────────────────────────

    onPreferredMintChanged: ({ mintUrl }) => {
      useMintStore.getState().setSelectedMint(mintUrl);
    },

    onNpcMintChanged: async ({ mintUrl }) => {
      const pk = config?.getPrivateKey?.();
      if (pk) {
        const ok = await useNpcMintStore.getState().updateServerMint(mintUrl, pk);
        if (ok) staticPopup('receive-mint-updated');
        else staticPopup('receive-mint-update-failed');
      }
    },

    onTransactionCreated: async ({ transactionId, rawInput }) => {
      if (rawInput) {
        useScanHistoryStore.getState().linkTransaction(rawInput, transactionId);
        // Bridge the scan annotation from its raw key onto the final entry id.
        linkTransactionAnnotation(rawAnnotationKey(rawInput), `id:${transactionId}`);
      }
      await captureAndStoreLocation(transactionId);
    },

    onP2PKReceiveCompleted: async ({ hadP2PKProofs }) => {
      if (hadP2PKProofs && useSettingsStore.getState().regenerateP2PKOnReceive) {
        const mgr = config?.getManager?.();
        if (mgr) {
          if ((getP2PKImportExtension(mgr)?.getPublicKeys() ?? []).length > 0) {
            return;
          }

          try {
            await mgr.keyring.generateKeyPair();
            const keypair = await mgr.keyring.getLatestKeyPair();
            config?.onP2pkKeyRefreshed?.(keypair?.publicKeyHex ?? null);
          } catch {
            // Non-critical — skip P2PK key regeneration
          }
        }
      }
    },
  };
}
