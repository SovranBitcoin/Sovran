/**
 * @fileoverview Sovran payment flow config — single source for coco-payment-ux glue
 *
 * Factory functions that inject Sovran-specific behavior into coco-payment-ux:
 * - createSovranNotifications: error/notification popups + state updates
 * - createSovranHandlers: step handlers (navigation, popups, dismiss)
 * - createSovranScreenActionHandlers: post-terminal actions (NFC, emoji picker)
 * - createSovranScanSources: scan input sources (clipboard, gallery, NFC)
 *
 * Operations (executeSend, executeMelt, buildMintListItems, etc.) are now built-in
 * via createCocoPaymentUX in the library.
 */


import * as Clipboard from 'expo-clipboard';
import { scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { paymentLog } from '@/shared/lib/logger';

import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import type {
  Manager,
  SendHistoryEntry,
  MeltHistoryEntry,
  MintHistoryEntry,
  ReceiveHistoryEntry,
} from '@cashu/coco-core';
import {
  type NotificationHandlerMap,
  type PaymentMachine,
  type ScanSources,
  type ScreenActionContext,
  type ScreenActionHandlerMap,
  type StepHandlerMap,
  type NfcIOAdapter,
} from 'coco-payment-ux';

import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { decode, isEncoded } from '@/shared/lib/third-party/emoji';
import { writeTokenToNFC } from '@/shared/lib/nfc';
import {
  allOptionsDisabledPopup,
  balanceTooLowPopup,
  cancelTransactionFailedPopup,
  copyPopup,
  couldNotCancelPopup,
  emojiPickerPopup,
  generalErrorPopup,
  mintUnreachablePopup,
  missingMeltTargetPopup,
  nfcConnectionLostPopup,
  nfcEcashSharedPopup,
  nfcErrorPopup,
  nfcSendFailedPopup,
  noAmountPopup,
  noMintSelectedPopup,
  noClipboardAddressPopup,
  noQrCodeFoundPopup,
  noValidMintPopup,
  operationInvalidStatePopup,
  operationNotFoundPopup,
  paymentCancelledPopup,
  paymentFallbackPopup,
  paymentOptionsPopup,
  paymentStatusPopup,
  proofSelectorPopup,
  qrScanFailedPopup,
  receiveFailedPopup,
  receiveMintUpdatedPopup,
  receiveMintUpdateFailedPopup,
  sendPaymentFailedPopup,
  tokenPendingNotRedeemedPopup,
  tokenRedeemedByRecipientPopup,
  transactionAlreadyCancelledPopup,
  transactionCancelledPopup,
  unsupportedInputPopup,
  unsupportedTokenUnitPopup,
} from '@/shared/lib/popup';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

// =============================================================================
// createSovranNotifications
// =============================================================================

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
      noAmountPopup();
    },
    NO_VALID_MINT: ({ code: _code, message, data: _data }) => {
      noValidMintPopup({ text: message });
    },
    INSUFFICIENT_BALANCE: ({ code: _code, message, data: _data }) => {
      balanceTooLowPopup({ text: message });
    },
    NO_BALANCE: ({ code: _code, message, data: _data }) => {
      balanceTooLowPopup({ text: message });
    },
    UNSUPPORTED_INPUT: ({ code: _code, message, data: _data }) => {
      unsupportedInputPopup({ text: message });
    },
    ALL_OPTIONS_DISABLED: ({ code: _code, message: _message, data: _data }) => {
      allOptionsDisabledPopup();
    },
    MISSING_MELT_TARGET: ({ code: _code, message: _message, data: _data }) => {
      missingMeltTargetPopup();
    },
    SEND_FAILED: ({ code: _code, message, data }) => {
      paymentLog.error('payment.notification.send_failed', { message });
      if (data?.mintUnreachable) {
        mintUnreachablePopup();
      } else {
        generalErrorPopup({ text: message });
      }
    },
    MINT_QUOTE_FAILED: ({ code: _code, message, data }) => {
      if (data?.mintUnreachable) {
        mintUnreachablePopup();
      } else {
        generalErrorPopup({ text: message });
      }
    },
    MELT_FAILED: ({ code: _code, message, data }) => {
      paymentLog.error('payment.notification.melt_failed', { message });
      if (data?.mintUnreachable) {
        mintUnreachablePopup();
      } else {
        generalErrorPopup({ text: message });
      }
    },
    PAYMENT_REQUEST_FAILED: ({ code: _code, message, data: _data }) => {
      sendPaymentFailedPopup({ text: message });
    },
    NFC_WRITE_FAILED: ({ code: _code, message, data: _data }) => {
      nfcErrorPopup({ title: 'NFC Write Failed', message });
    },
    NFC_SESSION_LOST: ({ code: _code, message, data: _data }) => {
      nfcErrorPopup({ title: 'NFC Connection Lost', message });
    },
    NFC_READ_FAILED: ({ code: _code, message, data: _data }) => {
      nfcErrorPopup({ title: 'NFC Read Failed', message });
    },
    onPaymentProcessing: (data) => {
      paymentLog.info('payment.processing', { variant: data.variant, mintUrl: data.mintUrl, amount: data.amount, unit: data.unit });
      const variant = data.variant === 'paymentRequest' ? 'payment-request' : data.variant;
      const id = `${data.variant}-${Date.now()}`;
      usePaymentStatusStore.getState().setActive({
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
      paymentLog.info('payment.confirmed', { variant: data.variant });
      const store = usePaymentStatusStore.getState();
      if (store.active) {
        if (data.variant === 'paymentRequest') {
          store.setDelivered(store.active.id);
        } else if (data.variant === 'melt' && data.historyEntry) {
          try {
            const parsed = JSON.parse(data.historyEntry);
            if (parsed.state === 'PENDING') return;
          } catch { /* fall through to confirm */ }
          store.setConfirmed(store.active.id);
        } else {
          store.setConfirmed(store.active.id);
        }
      }
    },
    onPaymentFailed: (data) => {
      paymentLog.error('payment.failed', { message: data.message, rolledBack: data.rolledBack });
      const store = usePaymentStatusStore.getState();
      if (store.active) {
        const msg = data.rolledBack
          ? `${data.message}\nYour funds have been returned.`
          : data.message;
        store.setFailed(store.active.id, new Error(msg));
      }
    },
    onScanEmpty: (source) => {
      if (source === 'clipboard') noClipboardAddressPopup();
      else if (source === 'gallery') noQrCodeFoundPopup();
    },
    onScanError: (source, err) => {
      if (source === 'gallery') qrScanFailedPopup();
      else generalErrorPopup({ text: err.message });
    },
    onMissingMintForAmount: () => {
      noMintSelectedPopup();
    },
    onCopied: (target) => {
      copyPopup(target as Parameters<typeof copyPopup>[0]);
    },
    onScanResolved: ({ rawInput, parsedType, intentType, source, container, optionKinds }) => {
      const typeMap: Record<string, 'ecash' | 'lightning' | 'npub' | 'mint' | 'paymentRequest' | 'unknown'> = {
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
      useScanHistoryStore.getState().addScan(rawInput, rawInput, scanType, scanSource, parsedType, container, optionKinds);
    },
    onNfcWriteFailed: ({ message, rolledBack }) => {
      const errorMsg = rolledBack ? `${message} Your funds have been returned.` : message;
      nfcErrorPopup({ title: 'NFC Write Failed', message: errorMsg });
    },

    // ── Screen action notifications ─────────────────────────────────

    onSendStatusChecked: ({ operationId: _operationId, state, redeemed }) => {
      if (redeemed || state === 'finalized') {
        tokenRedeemedByRecipientPopup();
      } else if (state === 'rolled_back') {
        transactionAlreadyCancelledPopup();
      } else if (state === 'not_found') {
        operationNotFoundPopup();
      } else if (state !== 'pending') {
        operationInvalidStatePopup({ state });
      } else {
        tokenPendingNotRedeemedPopup();
      }
    },

    onSendCancelled: (_data) => {
      transactionCancelledPopup();
    },

    onSendCancelFailed: ({ message, mintUnreachable }) => {
      if (mintUnreachable) {
        mintUnreachablePopup();
      } else {
        cancelTransactionFailedPopup({ text: message });
      }
    },

    onReceiveProcessing: ({ id, mintUrl, amount, unit }) => {
      paymentLog.info('payment.receive.processing', { id, mintUrl, amount, unit });
      const store = usePaymentStatusStore.getState();
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

    onReceiveConfirmed: async ({ id, historyEntry }) => {
      paymentLog.info('payment.receive.confirmed', { id });
      const store = usePaymentStatusStore.getState();
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
      paymentLog.error('payment.receive.failed', { id, message });
      const store = usePaymentStatusStore.getState();
      if (store.active?.id === id && store.active?.state === 'processing') {
        store.setFailed(id, new Error(message));
      } else {
        receiveFailedPopup({ text: message });
      }
    },

    onMeltCancelled: (_data) => {
      paymentCancelledPopup();
    },

    onMeltCancelFailed: ({ message, mintUnreachable }) => {
      if (mintUnreachable) {
        mintUnreachablePopup();
      } else {
        couldNotCancelPopup({ text: message });
      }
    },

    onUnsupportedTokenUnit: ({ unit }) => {
      unsupportedTokenUnitPopup({ unit });
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
      const pubkey = config?.getPubkey?.();
      if (pubkey) {
        useMintStore.getState().setSelectedMint(pubkey, mintUrl);
      }
    },

    onNpcMintChanged: async ({ mintUrl }) => {
      const pk = config?.getPrivateKey?.();
      if (pk) {
        const ok = await useNpcMintStore.getState().updateServerMint(mintUrl, pk);
        if (ok) receiveMintUpdatedPopup();
        else receiveMintUpdateFailedPopup();
      }
    },

    onTransactionCreated: async ({ transactionId, rawInput }) => {
      if (rawInput) {
        useScanHistoryStore.getState().linkTransaction(rawInput, transactionId);
      }
      await captureAndStoreLocation(transactionId);
    },

    onP2PKReceiveCompleted: async ({ hadP2PKProofs }) => {
      if (hadP2PKProofs && useSettingsStore.getState().regenerateP2PKOnReceive) {
        const mgr = config?.getManager?.();
        if (mgr) {
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

// =============================================================================
// createSovranScanSources
// =============================================================================

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
        paymentLog.error('payment.scan.gallery.failed', { error: err instanceof Error ? err : new Error(String(err)) });
        return { error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    nfc: nfcAdapter
      ? async () => {
          try {
            const data = await nfcAdapter.readPaymentRequest();
            return { data };
          } catch (err) {
            return { error: err instanceof Error ? err : new Error(String(err)) };
          }
        }
      : undefined,
  };
}

// =============================================================================
// createSovranHandlers
// =============================================================================

interface CreateSovranHandlersConfig {
  machine: PaymentMachine;
  onOptionDismiss?: () => void;
  getManager: () => Manager | null;
  getNpub?: () => string | undefined;
}

export function createSovranHandlers({
  machine,
  onOptionDismiss,
  getManager,
  getNpub,
}: CreateSovranHandlersConfig): StepHandlerMap {
  paymentLog.debug('payment.handlers.created');

  const mgr = getManager();

  return {
    receiveToken: ({ token }) => {
      paymentLog.info('payment.step.receive_token');
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    sendComplete: ({ historyEntry, mintWasOffline }) => {
      paymentLog.info('payment.step.send_complete', { mintWasOffline: !!mintWasOffline });
      router.navigate({
        pathname: '/(send-flow)/sendToken',
        params: {
          sendHistoryEntry: historyEntry,
          ...(mintWasOffline ? { mintWasOffline: 'true' } : {}),
        },
      });
    },

    navigateToPaymentRequest: ({ mintUrl, paymentRequest, amount, unit }) => {
      paymentLog.info('payment.step.navigate_payment_request', { mintUrl, amount, unit });
      const entry = {
        id: `pr-preview-${Date.now()}`,
        type: 'send',
        createdAt: Date.now(),
        mintUrl,
        amount,
        unit,
        state: 'prepared',
        metadata: { paymentRequest, phase: 'preview' },
      };
      const isFallback = (machine.getContext().failedOptionValues?.length ?? 0) > 0;
      const nav = isFallback ? router.replace : router.navigate;
      nav({
        pathname: '/(send-flow)/paymentRequest' as any,
        params: { paymentRequestEntry: JSON.stringify(entry) },
      });
    },

    navigateToMeltPreview: ({ mintUrl, meltTarget, amount, unit }) => {
      paymentLog.info('payment.step.navigate_melt_preview', { mintUrl, amount, unit });
      const entry: MeltHistoryEntry = {
        id: `melt-preview-${Date.now()}`,
        type: 'melt',
        createdAt: Date.now(),
        mintUrl,
        unit: unit ?? 'sat',
        quoteId: '',
        state: 'UNPAID',
        amount,
        metadata: { phase: 'preview', meltTarget },
      };
      const isFallback = (machine.getContext().failedOptionValues?.length ?? 0) > 0;
      const nav = isFallback ? router.replace : router.navigate;
      nav({
        pathname: '/(send-flow)/meltQuote',
        params: { meltHistoryEntry: JSON.stringify(entry) },
      });
    },

    mintQuoteCreated: ({ historyEntry, unit }) => {
      router.replace({
        pathname: '/(receive-flow)/mintQuote',
        params: { mintHistoryEntry: historyEntry, unit },
      });
    },

    reviewMint: ({ mintUrl, token, mintInfo }) => {
      const entry = {
        ...(mintInfo ?? {}),
        mintUrl,
        fromAccepter: true,
        token,
      };
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: { mintInfoEntry: JSON.stringify(entry) },
      });
    },

    openMint: ({ url, mintInfo }) => {
      const entry = {
        ...(mintInfo ?? {}),
        mintUrl: url,
        fromScan: true,
      };
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: { mintInfoEntry: JSON.stringify(entry) },
      });
    },

    openProfile: ({ npub }) => {
      router.navigate({
        pathname: '/(user-flow)/profile',
        params: { npub },
      });
    },

    navigateToReceive: async ({ unit }) => {
      const t0 = performance.now();
      const npub = getNpub?.();
      const selectedMintUrl = useNpcMintStore.getState().getActiveMintUrl();

      let p2pkKey: string | undefined;
      if (mgr) {
        try {
          const keypair = await mgr.keyring.getLatestKeyPair();
          p2pkKey = keypair?.publicKeyHex ?? undefined;
        } catch { /* ignore */ }
      }

      const entry = {
        type: 'receive',
        id: 'receive-hub',
        createdAt: Date.now(),
        mintUrl: selectedMintUrl ?? '',
        npcAddress: npub ? `${npub}@npubx.cash` : undefined,
        p2pkKey,
        selectedMintUrl,
        unit,
      };
      router.navigate({
        pathname: '/(receive-flow)/receive',
        params: { receiveEntry: JSON.stringify(entry), unit },
      });
      paymentLog.info('navigate.receive.done', { duration_ms: performance.now() - t0 });
    },

    enterAmount: ({ unit, preselectedMintUrl, constraints }) => {
      const t0 = performance.now();
      const entry = {
        destination: constraints.destination,
        unit,
        selectedMintUrl: preselectedMintUrl ?? '',
        ...(constraints.paymentRequest ? { paymentRequest: constraints.paymentRequest } : {}),
        ...(constraints.meltTarget ? { meltTarget: constraints.meltTarget } : {}),
      };
      const pathname =
        constraints.destination === 'mintQuote' ? '/(receive-flow)/amount' : '/(send-flow)/amount';
      router.navigate({
        pathname: pathname as any,
        params: { amountEntry: JSON.stringify(entry) },
      });
      paymentLog.info('navigate.enterAmount.done', { duration_ms: performance.now() - t0 });
    },

    selectMint: ({
      candidates: _candidates,
      supportedMintUrls: _supportedMintUrls,
      amount: _amount,
      unit,
      paymentRequest: _paymentRequest,
      meltTarget: _meltTarget,
      destination,
      mintListItems,
      scope,
    }) => {
      const entry = {
        items: mintListItems ?? [],
        scope: scope ?? 'selected',
        destination,
        unit,
      };

      const pathname =
        destination === 'mintQuote' || scope === 'npc'
          ? '/(receive-flow)/mintSelect'
          : '/(send-flow)/mintSelect';
      router.navigate({
        pathname: pathname as any,
        params: { mintSelectorEntry: JSON.stringify(entry) },
      });
    },

    chooseOption: (stepData) => {
      paymentOptionsPopup({ ...stepData, machine, onDismiss: onOptionDismiss });
    },

    chooseFallbackOption: (stepData) => {
      paymentFallbackPopup({ ...stepData, machine, onDismiss: onOptionDismiss });
    },

    chooseProofs: (stepData) => {
      proofSelectorPopup({ ...stepData, machine });
    },

    dismiss: () => {
      router.back();
    },
  };
}

// =============================================================================
// createSovranScreenActionHandlers
// =============================================================================

type Ctx<E> = ScreenActionContext<E> & { manager: Manager };

function sendCtx(ctx: ScreenActionContext): Ctx<SendHistoryEntry> {
  return ctx as Ctx<SendHistoryEntry>;
}

function mintQuoteCtx(ctx: ScreenActionContext): Ctx<MintHistoryEntry> {
  return ctx as Ctx<MintHistoryEntry>;
}

function receiveTokenCtx(ctx: ScreenActionContext): Ctx<ReceiveHistoryEntry> {
  return ctx as Ctx<ReceiveHistoryEntry>;
}

function meltQuoteCtx(ctx: ScreenActionContext): Ctx<MeltHistoryEntry> {
  return ctx as Ctx<MeltHistoryEntry>;
}

/**
 * App-specific screen action overrides. Only actions that require platform
 * primitives not available in coco-payment-ux (NFC writer, emoji picker).
 * All other actions are handled by the built-in default handlers.
 */
export function createSovranScreenActionHandlers(): ScreenActionHandlerMap {
  return {
    sendToken: {
      nfc: async (rawCtx) => {
        paymentLog.info('payment.screen_action.nfc.start');
        const { entry, manager } = sendCtx(rawCtx);
        if (!entry.token) {
          paymentLog.warn('payment.screen_action.nfc.no_token');
          return;
        }

        const writeResult = await writeTokenToNFC(getEncodedTokenV4(entry.token));
        if (writeResult.success) {
          paymentLog.info('payment.screen_action.nfc.success');
          nfcEcashSharedPopup();
          return;
        }

        const lostConnection =
          writeResult.errorCode === 'TAG_LOST' || writeResult.errorCode === 'TRANSCEIVE_FAILED';

        if (lostConnection && entry.operationId) {
          paymentLog.warn('payment.screen_action.nfc.connection_lost', { operationId: entry.operationId });
          try {
            await manager.ops.send.reclaim(entry.operationId);
            nfcConnectionLostPopup();
            return;
          } catch (rollbackError) {
            paymentLog.error('payment.screen_action.nfc.rollback_failed', { error: rollbackError });
            nfcSendFailedPopup({
              rollbackFailed: true,
              text: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            });
            return;
          }
        }

        nfcSendFailedPopup({
          text: writeResult.errorMessage || 'Unable to write token via NFC.',
        });
      },

      copyAsEmoji: async (rawCtx) => {
        const { entry } = sendCtx(rawCtx);
        if (!entry.token) return;
        emojiPickerPopup({ token: getEncodedTokenV4(entry.token) });
      },
    },
  };
}
