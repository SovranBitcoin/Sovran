/**
 * @fileoverview Sovran payment flow config — single source for coco-payment-ux glue
 *
 * All four factory functions that inject Sovran-specific behavior into coco-payment-ux:
 * - createSovranNotifications: error/notification popups
 * - createSovranOperations: executeSend, executeMintQuote, buildMintListItems
 * - createSovranHandlers: step handlers (navigation, popups, dismiss)
 * - createSovranScreenActionHandlers: post-terminal actions (copy, share, NFC, redeem, pay)
 *
 * Consumed by CocoPaymentUXProvider (notifications, operations, handlers, actions) and
 * useScreenActions (screen action handlers from context).
 */


import * as Clipboard from 'expo-clipboard';
import { scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import { getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import type {
  Manager,
  SendHistoryEntry,
  MeltHistoryEntry,
  MintHistoryEntry,
  ReceiveHistoryEntry,
} from 'coco-cashu-core';
import {
  defaultDetectors,
  buildMintAvailability,
  type Destination,
  type MachineOperations,
  type NotificationHandlerMap,
  type PaymentMachine,
  type ScanSources,
  type ScreenActionContext,
  type MintReviewInfo,
  type ScreenActionHandlerMap,
  type StepHandlerMap,
  type WalletContext,
  type NfcIOAdapter,
} from 'coco-payment-ux';

import { auditMint, fetchMintInfo } from '@/shared/lib/apiClient';
import { buildMintListItems } from '@/shared/lib/buildMintListItems';
import { getMintDisplayName, normalizeMintUrlKey } from '@/shared/lib/url';
import {
  buildReceiveHistoryEntry,
  isLightningInvoice,
  requestInvoiceFromLnurl,
} from '@/shared/lib/cashu/utils';
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
  missingMeltTargetPopup,
  nfcConnectionLostPopup,
  nfcEcashSharedPopup,
  nfcErrorPopup,
  nfcPaymentProgressPopup,
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
  sendPaymentFailedPopup,
  tokenPendingNotRedeemedPopup,
  tokenRedeemedByRecipientPopup,
  transactionAlreadyCancelledPopup,
  transactionCancelledPopup,
  unsupportedInputPopup,
  unsupportedTokenUnitPopup,
} from '@/shared/lib/popup';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

// =============================================================================
// createSovranNotifications
// =============================================================================

export function createSovranNotifications(): NotificationHandlerMap {
  return {
    NO_AMOUNT: ({ code: _code, message: _message, data: _data }) => {
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
    SEND_FAILED: ({ code: _code, message, data: _data }) => {
      generalErrorPopup({ text: message });
    },
    MINT_QUOTE_FAILED: ({ code: _code, message, data: _data }) => {
      generalErrorPopup({ text: message });
    },
    MELT_FAILED: ({ code: _code, message, data: _data }) => {
      generalErrorPopup({ text: message });
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
      const store = usePaymentStatusStore.getState();
      if (store.active) {
        store.setConfirmed(store.active.id);
      }
    },
    onPaymentFailed: (data) => {
      const store = usePaymentStatusStore.getState();
      if (store.active) {
        store.setFailed(store.active.id, new Error(data.message));
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
    onScanResolved: ({ rawInput, parsedType, intentType, source }) => {
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
      useScanHistoryStore.getState().addScan(rawInput, rawInput, scanType, scanSource, parsedType);
    },
    onNfcPaymentProgress: ({ phase }) => {
      nfcPaymentProgressPopup({ phase });
    },
    onNfcWriteFailed: ({ message, rolledBack }) => {
      nfcErrorPopup({
        title: 'NFC Write Failed',
        message: rolledBack ? `${message} Your funds have been returned.` : message,
      });
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

    onSendCancelFailed: ({ message }) => {
      cancelTransactionFailedPopup({ text: message });
    },

    onReceiveProcessing: ({ id, mintUrl, amount, unit }) => {
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

    onMeltCancelFailed: ({ message }) => {
      couldNotCancelPopup({ text: message });
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
  };
}

// =============================================================================
// createSovranScanSources
// =============================================================================

export function createSovranScanSources(nfcAdapter?: NfcIOAdapter): ScanSources {
  return {
    clipboard: async () => {
      const rawText = (await Clipboard.getStringAsync()).trim();
      const decodedText = isEncoded(rawText) ? decode(rawText) : rawText;
      if (!decodedText) return { empty: true };
      return { data: decodedText };
    },
    gallery: async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 1,
        });

        if (result.canceled || !result.assets?.[0]?.uri) return { canceled: true };

        const scannedCodes = await scanFromURLAsync(result.assets[0].uri, ['qr']);

        if (scannedCodes.length === 0) return { empty: true };

        return { data: scannedCodes[0].data };
      } catch (err) {
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
// createSovranOperations
// =============================================================================

interface CreateSovranOperationsConfig {
  getManager: () => Manager | null;
  getWalletContext: () => WalletContext | null;
}

export function createSovranOperations({
  getManager,
  getWalletContext,
}: CreateSovranOperationsConfig): MachineOperations {
  return {
    executeSend: async (mintUrl, amount) => {
      if (useSettingsStore.getState().mockFailSend) {
        throw new Error('Mock send failure (developer setting)');
      }
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      await mgr.wallet.send(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory();
      const entry = history.find(
        (h) => h.type === 'send' && (h as SendHistoryEntry).mintUrl === mintUrl
      ) as SendHistoryEntry | undefined;
      if (!entry) throw new Error('Send history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    executeMintQuote: async (mintUrl, amount, _unit) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      const mintQuote = await mgr.quotes.createMintQuote(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory();
      const entry = history.find(
        (h) => h.type === 'mint' && (h as MintHistoryEntry).quoteId === mintQuote.quote
      ) as MintHistoryEntry | undefined;
      if (!entry) throw new Error('Mint quote history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    buildMintListItems: async (stepData) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      const [allTrustedMints, balances] = await Promise.all([
        mgr.mint.getAllTrustedMints(),
        mgr.wallet.getBalances(),
      ]);
      const availability = allTrustedMints.map((mint) =>
        buildMintAvailability({
          mintUrl: mint.mintUrl,
          balance: balances[mint.mintUrl] ?? 0,
          supportedMintUrls: stepData.supportedMintUrls,
          amount: stepData.amount,
          destination: stepData.destination,
        })
      );
      const offlineCheck =
        (stepData.destination === 'sendEcash' || stepData.destination === 'paymentRequest') &&
        stepData.amount
          ? {
              amount: stepData.amount,
              proofAmounts: getWalletContext()?.proofAmounts ?? {},
            }
          : undefined;
      return buildMintListItems(allTrustedMints, availability, offlineCheck);
    },

    trustMint: async (mintUrl) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      await mgr.mint.addMint(mintUrl, { trusted: true });
    },

    buildMintReviewInfo: async (mintUrl): Promise<MintReviewInfo> => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      return loadMintReviewInfo(mgr, mintUrl, getWalletContext()?.preferredMintUrl);
    },

    executeMelt: async (mintUrl, meltTarget, amount, _unit) => {
      if (useSettingsStore.getState().mockFailMelt) {
        throw new Error('Mock melt failure (developer setting)');
      }
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');

      const bolt11 = isLightningInvoice(meltTarget)
        ? meltTarget
        : await requestInvoiceFromLnurl(meltTarget, amount);

      const operation = await mgr.quotes.prepareMeltBolt11(mintUrl, bolt11);
      const result = await mgr.quotes.executeMelt(operation.id);

      const entry: MeltHistoryEntry = {
        id: result.id,
        type: 'melt',
        createdAt: result.createdAt,
        mintUrl: result.mintUrl,
        unit: 'sat',
        quoteId: result.quoteId,
        state: mapMeltOperationState(result.state),
        amount: result.amount,
        metadata: { operationId: result.id, meltTarget },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    executePaymentRequest: async (mintUrl, paymentRequest, amount, unit) => {
      if (useSettingsStore.getState().mockFailPaymentRequest) {
        throw new Error('Mock payment request failure (developer setting)');
      }
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');

      const info = defaultDetectors.getPaymentRequestInfo(paymentRequest);
      if (!info) throw new Error('Invalid payment request');

      const nostrTransport = info.transports?.find((t) => t.type === 'nostr');
      const httpTransport = info.transports?.find((t) => t.type === 'post');
      const parsed =
        nostrTransport && !httpTransport
          ? buildInbandParsedPaymentRequest(paymentRequest, info, mintUrl)
          : await mgr.wallet.processPaymentRequest(paymentRequest);

      const transaction = await mgr.wallet.preparePaymentRequestTransaction(mintUrl, parsed, amount);
      const operationId = transaction.sendOperation.id;

      if (httpTransport) {
        await mgr.wallet.handleHttpPaymentRequest(transaction);
      } else {
        await mgr.wallet.handleInbandPaymentRequest(transaction, async () => {});
      }

      const sendEntry = await findSendHistoryEntryByOperationId(mgr, operationId);
      const entry = sendEntry ?? {
        id: operationId,
        type: 'send' as const,
        createdAt: transaction.sendOperation.createdAt,
        mintUrl,
        amount,
        unit,
        operationId,
        state: 'pending',
        metadata: { paymentRequest, phase: 'delivered', tokenCreated: 'true' },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    linkTransaction: (scannedInput, transactionId) => {
      useScanHistoryStore.getState().linkTransaction(scannedInput, transactionId);
    },

    executeNfcSend: async (mintUrl, amount) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      const prepared = await mgr.send.prepareSend(mintUrl, amount);
      const { operation, token } = await mgr.send.executePreparedSend(prepared.id);
      const entry = await findSendHistoryEntryByOperationId(mgr, operation.id);
      if (!entry) throw new Error('Send history entry not found after creation');
      return {
        token: getEncodedTokenV4(token),
        historyEntry: JSON.stringify(entry),
        operationId: operation.id,
      };
    },

    rollbackSend: async (operationId) => {
      const mgr = getManager();
      if (!mgr) return;
      try {
        const operation = await mgr.send.getOperation(operationId);
        if (operation && ['prepared', 'executing', 'pending'].includes(operation.state)) {
          await mgr.send.rollback(operationId);
        }
      } catch (e) {
        console.warn('[NFC] Rollback failed:', e);
      }
    },

    // ── Screen action operations ────────────────────────────────────

    checkSendStatus: async (operationId) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');

      const operation = await mgr.send.getOperation(operationId);
      if (!operation) return { state: 'not_found' };

      if (operation.state === 'pending') {
        await mgr.send.checkPendingOperation(operationId);
        const updated = await mgr.send.getOperation(operationId);
        return { state: updated?.state ?? operation.state };
      }
      return { state: operation.state };
    },

    executeReceive: async (tokenString, mintUrl, amount) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');

      await mgr.wallet.receive(tokenString);

      // P2PK key regeneration
      if (useSettingsStore.getState().regenerateP2PKOnReceive) {
        try {
          const decoded = getDecodedToken(tokenString);
          const hasP2PK = decoded.proofs.some((proof) => {
            try {
              const parsed = JSON.parse(proof.secret);
              return Array.isArray(parsed) && parsed[0] === 'P2PK';
            } catch {
              return false;
            }
          });
          if (hasP2PK) {
            await mgr.keyring.generateKeyPair();
          }
        } catch (e) {
          console.warn('Failed to regenerate P2PK key:', e);
        }
      }

      const realEntry = await findReceiveHistoryEntryByToken(mgr, tokenString, mintUrl, amount);
      if (!realEntry) throw new Error('Receive history entry not found after redemption');
      return { historyEntry: JSON.stringify(realEntry) };
    },

    isMintTrusted: async (mintUrl) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      return mgr.mint.isTrustedMint(mintUrl);
    },

    rollbackMelt: async (operationId) => {
      const mgr = getManager();
      if (!mgr) throw new Error('Wallet manager is not available');
      await mgr.quotes.rollbackMelt(operationId, 'User cancelled');
    },
  };
}

// =============================================================================
// Shared helpers
// =============================================================================

async function loadMintReviewInfo(
  mgr: Manager,
  mintUrl: string,
  preferredMintUrl?: string
): Promise<MintReviewInfo> {
  const [mintInfoResult, auditResult, balances, isTrusted] = await Promise.all([
    fetchMintInfo(mintUrl),
    auditMint({ mintUrl }),
    mgr.wallet.getBalances(),
    mgr.mint.isTrustedMint(mintUrl),
  ]);

  const mintInfo = mintInfoResult.isOk() ? mintInfoResult.value : undefined;
  const auditData = auditResult.isOk() ? auditResult.value : undefined;

  if (auditData && mintInfo) {
    useAuditMintStore.getState().setCached(mintUrl, auditData, mintInfo);
  }

  const normalizedUrl = normalizeMintUrlKey(mintUrl);
  const kymScore = useKYMMintStore.getState().getCached(normalizedUrl)?.score;

  const swaps = auditData?.swaps ?? [];
  const swapSuccess = swaps.reduce((acc, s) => acc + (s.state === 'OK' ? 1 : 0), 0);
  const swapTotal = swaps.length;
  const successRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
  const auditScore = typeof successRate === 'number' ? successRate * 5 : undefined;

  const successfulTimes = swaps
    .filter((s) => s.state === 'OK' && typeof s.time_taken === 'number' && s.time_taken > 0)
    .map((s) => s.time_taken);
  const avgTimeMs =
    successfulTimes.length > 0
      ? successfulTimes.reduce((sum, t) => sum + t, 0) / successfulTimes.length
      : undefined;

  return {
    mintUrl,
    displayName: getMintDisplayName(mintUrl, mintInfo),
    iconUrl: mintInfo?.icon_url ?? undefined,
    description: mintInfo?.description ?? undefined,
    longDescription: mintInfo?.description_long ?? undefined,
    motd: mintInfo?.motd ?? undefined,
    contact: mintInfo?.contact ?? undefined,
    nuts: mintInfo?.nuts ? Object.keys(mintInfo.nuts).map(Number) : undefined,
    balance: balances[mintUrl] ?? 0,
    unit: 'sat',
    isPreferred: mintUrl === preferredMintUrl,
    isTrusted,
    kymScore,
    auditScore,
    auditState: auditData?.state,
    successRate,
    avgTimeMs,
    swapSuccess,
    swapTotal,
    totalMints: auditData?.n_mints,
    totalMelts: auditData?.n_melts,
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
  return {
    receiveToken: ({ token }) => {
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    sendComplete: ({ historyEntry }) => {
      router.navigate({
        pathname: '/(send-flow)/sendToken',
        params: { sendHistoryEntry: historyEntry },
      });
    },

    navigateToPaymentRequest: ({ mintUrl, paymentRequest, amount, unit }) => {
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
      const npub = getNpub?.();
      const selectedMintUrl = useNpcMintStore.getState().getActiveMintUrl();
      let p2pkKey: string | undefined;
      const mgr = getManager();
      if (mgr) {
        try {
          const keypair = await mgr.keyring.getLatestKeyPair();
          p2pkKey = keypair?.publicKeyHex;
        } catch {
          /* ignore */
        }
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
    },

    enterAmount: ({ unit, preselectedMintUrl, constraints }) => {
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
type EntryRecord = Record<string, unknown>;

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

type PaymentRequestEntry = {
  id: string;
  type: 'send';
  createdAt: number;
  mintUrl: string;
  amount: number;
  unit: string;
  state: string;
  metadata: {
    paymentRequest: string;
    phase: string;
    tokenCreated?: string;
    nostrSent?: string;
    operationId?: string;
  };
};

type PaymentRequestCtx = ScreenActionContext<PaymentRequestEntry> & {
  manager: Manager;
  sendDirectMessage: (nprofile: string, message: string) => Promise<void>;
  setEntry?: (entry: Record<string, unknown>) => void;
};

function paymentRequestCtx(ctx: ScreenActionContext): PaymentRequestCtx {
  return ctx as unknown as PaymentRequestCtx;
}

function isRecord(value: unknown): value is EntryRecord {
  return typeof value === 'object' && value !== null;
}

function mergeScreenEntry(currentEntry: EntryRecord, patch: EntryRecord): EntryRecord {
  const currentMetadata = isRecord(currentEntry.metadata) ? currentEntry.metadata : {};
  const patchMetadata = isRecord(patch.metadata) ? patch.metadata : {};

  return {
    ...currentEntry,
    ...patch,
    ...((Object.keys(currentMetadata).length > 0 || Object.keys(patchMetadata).length > 0) && {
      metadata: {
        ...currentMetadata,
        ...patchMetadata,
      },
    }),
  };
}

async function findSendHistoryEntryByOperationId(
  manager: Manager,
  operationId: string,
  attempts: number = 3
): Promise<SendHistoryEntry | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const history = await manager.history.getPaginatedHistory(0, 100);
    const entry = history.find(
      (item) => item.type === 'send' && (item as SendHistoryEntry).operationId === operationId
    ) as SendHistoryEntry | undefined;

    if (entry) {
      return entry;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  return null;
}

async function findReceiveHistoryEntryByToken(
  manager: Manager,
  tokenString: string,
  mintUrl: string,
  amount: number,
  attempts: number = 3
): Promise<ReceiveHistoryEntry | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const history = await manager.history.getPaginatedHistory(0, 100);
    const entry = history.find((item) => {
      if (item.type !== 'receive') {
        return false;
      }

      const receiveEntry = item as ReceiveHistoryEntry;
      if (receiveEntry.token) {
        try {
          return getEncodedTokenV4(receiveEntry.token) === tokenString;
        } catch {
          // Fall back to mint/amount matching below.
        }
      }

      return receiveEntry.mintUrl === mintUrl && receiveEntry.amount === amount;
    }) as ReceiveHistoryEntry | undefined;

    if (entry) {
      return entry;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  return null;
}

function buildInbandParsedPaymentRequest(
  encodedRequest: string,
  info: NonNullable<ReturnType<typeof defaultDetectors.getPaymentRequestInfo>>,
  mintUrl: string
): Parameters<Manager['wallet']['preparePaymentRequestTransaction']>[1] {
  const requiredMints = info.mints ?? [];
  const matchingMints =
    requiredMints.length > 0
      ? requiredMints.filter((candidate) => candidate === mintUrl)
      : [mintUrl];

  return {
    paymentRequest: encodedRequest as never,
    matchingMints,
    requiredMints,
    amount: info.amount,
    transport: { type: 'inband' as const },
  } as Parameters<Manager['wallet']['preparePaymentRequestTransaction']>[1];
}

function mapMeltOperationState(state: string): MeltHistoryEntry['state'] {
  if (state === 'finalized') return 'PAID';
  if (state === 'pending' || state === 'executing') return 'PENDING';
  return 'UNPAID';
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
        const { entry, manager } = sendCtx(rawCtx);
        if (!entry.token) return;

        const writeResult = await writeTokenToNFC(getEncodedTokenV4(entry.token));
        if (writeResult.success) {
          nfcEcashSharedPopup();
          return;
        }

        const lostConnection =
          writeResult.errorCode === 'TAG_LOST' || writeResult.errorCode === 'TRANSCEIVE_FAILED';

        if (lostConnection && entry.operationId) {
          try {
            await manager.send.rollback(entry.operationId);
            nfcConnectionLostPopup();
            return;
          } catch (rollbackError) {
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
