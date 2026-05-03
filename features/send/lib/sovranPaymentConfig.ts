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

import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { paymentLog } from '@/shared/lib/logger';
import { mintLocalId } from '@/shared/lib/id';

import { getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import type {
  Manager,
  SendHistoryEntry,
  MeltHistoryEntry,
  MintHistoryEntry,
  ReceiveHistoryEntry,
} from '@cashu/coco-core';
import {
  type MachineOperations,
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
import { writeTokenToNFC, NfcError } from '@/shared/lib/nfc';
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
import { executeRoutstrTopUp, formatRoutstrBalance } from '@/shared/lib/routstr/topUp';
import {
  routstrTopUpSuccessPopup,
  routstrWalletCreatedPopup,
  routstrTransactionFailedPopup,
} from '@/shared/lib/popup/popups/routstr';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';

// =============================================================================
// createSovranExecuteReceive
// =============================================================================

/**
 * Sovran-side override for coco-payment-ux's default `executeReceive`.
 *
 * Why this exists:
 *
 * coco-payment-ux's default `executeReceive` (defaultOperations.ts:502) calls
 * `mgr.wallet.receive(token)`, then tries to find the resulting persisted
 * history entry by matching `metadata.rawToken === tokenString || h.token ===
 * tokenString`. When the lookup fails (race against coco's history write, or
 * a metadata-shape mismatch), it falls back to a SYNTHESIZED entry with id
 * `redeemed-${Date.now()}`.
 *
 * That synthesized id then propagates through the entire downstream chain
 * (setEntry, linkTransaction, onReceiveConfirmed, onTransactionCreated), so
 * the location stamp and scan-history link end up keyed to a fake id. When
 * the user later opens the receive from the transaction list, the row carries
 * coco's *real* persisted id, the lookups miss, and the location/source
 * disappear.
 *
 * The fix is to NEVER let a synthesized id flow downstream. We snapshot the
 * set of receive entry ids for this mint BEFORE calling `wallet.receive`,
 * then after the receive we poll the history for any new id that wasn't in
 * the snapshot. Set-difference is robust regardless of how `metadata` /
 * `token` is shaped on the persisted entry.
 */
export function createSovranExecuteReceive(
  getManager: () => Manager | null
): NonNullable<MachineOperations['executeReceive']> {
  return async (tokenString, mintUrl, _amount) => {
    const manager = getManager();
    if (!manager) {
      paymentLog.error('payment.execute_receive.no_manager');
      throw new Error('Wallet manager is not available');
    }

    // Snapshot existing receive ids for this mint so we can identify the
    // newly-persisted entry by set difference after the receive completes.
    let beforeIds: Set<string>;
    try {
      const beforeHistory = await manager.history.getPaginatedHistory(0, 100);
      beforeIds = new Set(
        (beforeHistory as ReadonlyArray<Record<string, unknown>>)
          .filter((h) => h.type === 'receive' && h.mintUrl === mintUrl)
          .map((h) => (typeof h.id === 'string' ? h.id : ''))
          .filter((id) => id.length > 0)
      );
    } catch (e) {
      paymentLog.warn('payment.execute_receive.snapshot_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      beforeIds = new Set();
    }

    // P2PK detection — preserved from coco's default so the downstream
    // onP2PKReceiveCompleted notification still fires for users with
    // `regenerateP2PKOnReceive` enabled.
    let hadP2PKProofs = false;
    try {
      const decoded = getDecodedToken(tokenString);
      hadP2PKProofs = decoded.proofs.some((p) => {
        try {
          const parsed = JSON.parse(p.secret);
          return Array.isArray(parsed) && parsed[0] === 'P2PK';
        } catch {
          return false;
        }
      });
    } catch {
      // proof decode failure — fall back to false (no regression)
    }

    paymentLog.info('payment.execute_receive.start', {
      mintUrl,
      beforeCount: beforeIds.size,
    });
    await manager.wallet.receive(tokenString);

    // Poll for the newly persisted receive entry. Set difference makes this
    // robust to race conditions in coco's history flush — we just wait until
    // a new receive id appears for this mint.
    const MAX_ATTEMPTS = 50; // ~10s of polling at 200ms intervals
    const DELAY_MS = 200;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const after = await manager.history.getPaginatedHistory(0, 100);
        const newEntry = (after as ReadonlyArray<Record<string, unknown>>).find((h) => {
          const id = typeof h.id === 'string' ? h.id : '';
          return (
            h.type === 'receive' && h.mintUrl === mintUrl && id.length > 0 && !beforeIds.has(id)
          );
        });
        if (newEntry?.id) {
          paymentLog.info('payment.execute_receive.found', {
            mintUrl,
            realId: newEntry.id,
            attempts: attempt + 1,
          });
          return {
            historyEntry: JSON.stringify(newEntry),
            hadP2PKProofs,
          };
        }
      } catch (e) {
        paymentLog.warn('payment.execute_receive.poll_failed', {
          attempt,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    // No real entry materialized within ~10s. The receive's proofs are
    // already persisted (mgr.wallet.receive returned successfully), so we
    // cannot fail the UX without confusing the user. Fall back to coco's
    // original synthesized-entry behavior so the receive screen still
    // completes — but log loudly so the deeper coco-history flush issue
    // gets attention.
    paymentLog.error('payment.execute_receive.timeout_fallback', {
      mintUrl,
      polledMs: MAX_ATTEMPTS * DELAY_MS,
    });
    let tokenAmount = 0;
    try {
      const decoded = getDecodedToken(tokenString);
      tokenAmount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);
    } catch {
      /* ignore */
    }
    const fallbackEntry = {
      id: mintLocalId('redeemed'),
      type: 'receive' as const,
      createdAt: Date.now(),
      mintUrl,
      unit: 'sat',
      amount: tokenAmount,
      metadata: { rawToken: tokenString },
    };
    return {
      historyEntry: JSON.stringify(fallbackEntry),
      hadP2PKProofs,
    };
  };
}

// =============================================================================
// createSovranExecuteMintQuote
// =============================================================================

/**
 * Sovran-side override for coco-payment-ux's default `executeMintQuote`.
 *
 * coco-payment-ux's default (defaultOperations.ts:275) calls
 * `mgr.ops.mint.prepare(...)` and constructs the history entry directly from
 * the returned operation, using `mintOp.id` as the entry id. The comment at
 * defaultOperations.ts:291 acknowledges the race: it builds from the
 * operation result *to avoid a race where getPaginatedHistory runs before
 * HistoryService persists the row*. The unspoken risk is that coco's
 * persisted row may end up with a different id (or different field shape)
 * than `mintOp.id`. When that happens, the location stamp captured at
 * onTransactionCreated (under `mintOp.id`) and the scan history link end up
 * keyed to an id that doesn't match what `usePaginatedHistory` returns
 * later — same class of bug as the receive case.
 *
 * Fix: snapshot mint ids for this mintUrl before prepare, then poll coco
 * history for the persisted row by `quoteId` (deterministic — no race) and
 * fall back to set-difference. Use coco's persisted row as authoritative for
 * the id, while preserving `paymentRequest` from the operation result so
 * the MintQuoteScreen still has a lightning invoice to display.
 */
export function createSovranExecuteMintQuote(
  getManager: () => Manager | null
): NonNullable<MachineOperations['executeMintQuote']> {
  return async (mintUrl, amount, _unit) => {
    const manager = getManager();
    if (!manager) {
      paymentLog.error('payment.execute_mint_quote.no_manager');
      throw new Error('Wallet manager is not available');
    }

    // Snapshot existing mint ids for this mint URL so we can detect the
    // newly-persisted row by set difference if quoteId matching fails.
    let beforeIds: Set<string>;
    try {
      const beforeHistory = await manager.history.getPaginatedHistory(0, 100);
      beforeIds = new Set(
        (beforeHistory as ReadonlyArray<Record<string, unknown>>)
          .filter((h) => h.type === 'mint' && h.mintUrl === mintUrl)
          .map((h) => (typeof h.id === 'string' ? h.id : ''))
          .filter((id) => id.length > 0)
      );
    } catch (e) {
      paymentLog.warn('payment.execute_mint_quote.snapshot_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      beforeIds = new Set();
    }

    paymentLog.info('payment.execute_mint_quote.start', { mintUrl, amount });
    const mintOp = await manager.ops.mint.prepare({ mintUrl, amount, method: 'bolt11' });
    paymentLog.info('payment.execute_mint_quote.prepared', {
      operationId: mintOp.id,
      quoteId: mintOp.quoteId,
    });

    // Constructed entry — used as a fallback (same shape as coco's default
    // executeMintQuote) and as the source of `paymentRequest` if coco's
    // persisted row doesn't carry it.
    const constructedEntry = {
      id: mintOp.id,
      type: 'mint' as const,
      createdAt: (mintOp as Record<string, unknown>).createdAt ?? Date.now(),
      mintUrl: ((mintOp as Record<string, unknown>).mintUrl as string) ?? mintUrl,
      unit: ((mintOp as Record<string, unknown>).unit as string) ?? 'sat',
      quoteId: mintOp.quoteId,
      state: 'UNPAID' as const,
      amount: ((mintOp as Record<string, unknown>).amount as number) ?? amount,
      paymentRequest: (mintOp as Record<string, unknown>).request as string | undefined,
      metadata: { operationId: mintOp.id },
    };

    // Poll for coco's persisted row. Prefer quoteId match (deterministic);
    // fall back to id-diff against the pre-prepare snapshot.
    const MAX_ATTEMPTS = 50; // ~10s of polling at 200ms intervals
    const DELAY_MS = 200;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const after = await manager.history.getPaginatedHistory(0, 100);
        const persisted = (after as ReadonlyArray<Record<string, unknown>>).find((h) => {
          if (h.type !== 'mint' || h.mintUrl !== mintUrl) return false;
          // Preferred: deterministic quoteId match
          if (mintOp.quoteId && typeof h.quoteId === 'string' && h.quoteId === mintOp.quoteId) {
            return true;
          }
          // Fallback: set difference on ids
          const id = typeof h.id === 'string' ? h.id : '';
          return id.length > 0 && !beforeIds.has(id);
        });
        if (persisted) {
          paymentLog.info('payment.execute_mint_quote.found', {
            mintUrl,
            persistedId: persisted.id,
            constructedId: mintOp.id,
            matchedById: persisted.id === mintOp.id,
            attempts: attempt + 1,
          });
          // Use coco's persisted row as authoritative (so its real id flows
          // downstream), but preserve `paymentRequest` from the operation
          // result if coco's row doesn't carry it.
          const merged = {
            ...persisted,
            paymentRequest:
              (persisted as Record<string, unknown>).paymentRequest ??
              constructedEntry.paymentRequest,
          };
          return { historyEntry: JSON.stringify(merged) };
        }
      } catch (e) {
        paymentLog.warn('payment.execute_mint_quote.poll_failed', {
          attempt,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    // Last resort: same fallback as coco's default. Logged loudly so we know
    // the polling didn't catch the persisted row.
    paymentLog.error('payment.execute_mint_quote.timeout_fallback', {
      mintUrl,
      operationId: mintOp.id,
      polledMs: MAX_ATTEMPTS * DELAY_MS,
    });
    return { historyEntry: JSON.stringify(constructedEntry) };
  };
}

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
      paymentLog.info('payment.processing', {
        variant: data.variant,
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
      });
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
          } catch {
            /* fall through to confirm */
          }
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
        .addScan(rawInput, rawInput, scanType, scanSource, parsedType, container, optionKinds);
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
        paymentLog.error('payment.scan.gallery.failed', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
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

  return {
    receiveToken: ({ token }) => {
      paymentLog.info('payment.step.receive_token');
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    sendComplete: async ({ historyEntry, mintWasOffline }) => {
      paymentLog.info('payment.step.send_complete', { mintWasOffline: !!mintWasOffline });

      // Routstr top-up: intercept the token and send it to the Routstr API
      const topUpState = useRoutstrTopUpStore.getState();
      if (topUpState.active) {
        try {
          const entry = JSON.parse(historyEntry);
          const encodedToken = getEncodedTokenV4(entry.token);
          const result = await executeRoutstrTopUp(encodedToken);

          if (result.success) {
            const balanceStr = formatRoutstrBalance(result.balance);
            if (result.isNewWallet) {
              routstrWalletCreatedPopup({ balance: balanceStr });
            } else {
              routstrTopUpSuccessPopup({ balance: balanceStr });
            }
            useRoutstrTopUpStore.getState().complete('success');
          } else {
            routstrTransactionFailedPopup({ text: result.error });
            useRoutstrTopUpStore.getState().complete('failed');
          }
        } catch (e) {
          paymentLog.error('payment.routstr_topup.error', {
            error: e instanceof Error ? e.message : String(e),
          });
          routstrTransactionFailedPopup({ text: 'Failed to process top-up' });
          useRoutstrTopUpStore.getState().complete('failed');
        }
        router.dismiss();
        return;
      }

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
        id: mintLocalId('pr-preview'),
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
        pathname: '/(send-flow)/paymentRequest',
        params: { paymentRequestEntry: JSON.stringify(entry) },
      });
    },

    navigateToMeltPreview: ({ mintUrl, meltTarget, amount, unit }) => {
      paymentLog.info('payment.step.navigate_melt_preview', { mintUrl, amount, unit });
      const entry: MeltHistoryEntry = {
        id: mintLocalId('melt-preview'),
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
      const currentMgr = getManager();
      if (currentMgr) {
        try {
          const keypair = await currentMgr.keyring.getLatestKeyPair();
          p2pkKey = keypair?.publicKeyHex ?? undefined;
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
      const params = { amountEntry: JSON.stringify(entry) };
      router.navigate(
        constraints.destination === 'mintQuote'
          ? { pathname: '/(receive-flow)/amount', params }
          : { pathname: '/(send-flow)/amount', params }
      );
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

      const params = { mintSelectorEntry: JSON.stringify(entry) };
      router.navigate(
        destination === 'mintQuote' || scope === 'npc'
          ? { pathname: '/(receive-flow)/mintSelect', params }
          : { pathname: '/(send-flow)/mintSelect', params }
      );
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

        try {
          await writeTokenToNFC(getEncodedTokenV4(entry.token));
          paymentLog.info('payment.screen_action.nfc.success');
          nfcEcashSharedPopup();
          return;
        } catch (rawError) {
          const code = rawError instanceof NfcError ? rawError.code : 'WRITE_FAILED';
          const message =
            rawError instanceof Error ? rawError.message : 'Unable to write token via NFC.';
          const lostConnection = code === 'TAG_LOST' || code === 'TRANSCEIVE_FAILED';

          if (lostConnection && entry.operationId) {
            paymentLog.warn('payment.screen_action.nfc.connection_lost', {
              operationId: entry.operationId,
            });
            try {
              await manager.ops.send.reclaim(entry.operationId);
              nfcConnectionLostPopup();
              return;
            } catch (rollbackError) {
              paymentLog.error('payment.screen_action.nfc.rollback_failed', {
                error:
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
              });
              nfcSendFailedPopup({
                rollbackFailed: true,
                text:
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
              });
              return;
            }
          }

          nfcSendFailedPopup({ text: message });
        }
      },

      /**
       * Route text vs emoji copy on the sendToken screen. Split-menu UI
       * (`ActionMenuButton`) calls `actions.copy.execute({ variantId })` with
       * `'text'` or `'emoji'`. An omitted `variantId` (legacy callers) falls
       * through to the text path, preserving prior behavior.
       */
      copy: async (rawCtx) => {
        const { entry } = sendCtx(rawCtx);
        if (!entry.token) return;
        const variantId =
          typeof (rawCtx as unknown as { variantId?: unknown }).variantId === 'string'
            ? (rawCtx as unknown as { variantId: string }).variantId
            : 'text';
        if (variantId === 'emoji') {
          emojiPickerPopup({ token: getEncodedTokenV4(entry.token) });
          return;
        }
        // Default — text clipboard copy.
        try {
          await Clipboard.setStringAsync(getEncodedTokenV4(entry.token));
          copyPopup('token');
          paymentLog.info('payment.send_token.copy.text.success', { entryId: entry.id });
        } catch (e) {
          paymentLog.error('payment.send_token.copy.failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
      /**
       * @deprecated — reach this via `copy({ variantId: 'emoji' })` now. The
       * action name is retained for a release so any extant callers still work.
       */
      copyAsEmoji: async (rawCtx) => {
        const { entry } = sendCtx(rawCtx);
        if (!entry.token) return;
        emojiPickerPopup({ token: getEncodedTokenV4(entry.token) });
      },
    },

    // ── mintQuote (Lightning receive) ────────────────────────────────
    //
    // We override copy/share so we can record the *outbound distribution*
    // method for the resulting transaction. The other wallet's payment
    // method is unknowable, but we can capture which channel WE used to
    // share the lightning invoice. The 'displayed' fallback is written by
    // a global subscription in CocoPaymentUX.tsx when the quote transitions
    // to PAID/ISSUED without any explicit copy/share action.
    //
    // The distribution store is keyed by `quoteId` (NOT historyEntry.id)
    // for mint entries. quoteId is the deterministic identifier carried
    // by the lightning quote itself — it's identical whether resolved from
    // the screen entry, from a coco event payload, or from the persisted
    // history row. Using historyEntry.id would risk a key mismatch if the
    // screen entry's id (e.g. mintOp.id from a fallback) differs from
    // coco's persisted row id, which is exactly the bug that caused the
    // first-write-wins guard to silently fail in earlier versions.
    //
    // Both overrides reproduce the built-in handler's user-facing behavior
    // (clipboard write / share sheet + popup) so the UX is unchanged.
    mintQuote: {
      copy: async (rawCtx) => {
        const { entry } = mintQuoteCtx(rawCtx);
        const paymentRequest = entry.paymentRequest;
        const quoteId = entry.quoteId;
        if (!paymentRequest || !quoteId) {
          paymentLog.warn('payment.mint_quote.copy.no_payment_request', {
            hasPaymentRequest: !!paymentRequest,
            hasQuoteId: !!quoteId,
          });
          return;
        }
        try {
          await Clipboard.setStringAsync(paymentRequest);
          useTransactionDistributionStore.getState().setDistribution(quoteId, 'copy');
          paymentLog.info('payment.mint_quote.copy.success', {
            quoteId,
            entryId: entry.id,
          });
          copyPopup('paymentRequest');
        } catch (e) {
          paymentLog.error('payment.mint_quote.copy.failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },

      share: async (rawCtx) => {
        const { entry } = mintQuoteCtx(rawCtx);
        const paymentRequest = entry.paymentRequest;
        const quoteId = entry.quoteId;
        if (!paymentRequest || !quoteId) {
          paymentLog.warn('payment.mint_quote.share.no_payment_request', {
            hasPaymentRequest: !!paymentRequest,
            hasQuoteId: !!quoteId,
          });
          return;
        }
        try {
          // Read the share result so we can detect AirDrop on iOS. The
          // built-in coco-payment-ux platform.share at CocoPaymentUX.tsx
          // discards the result, so we can't piggyback on it.
          const result = await Share.share({ message: paymentRequest });
          if (result.action !== Share.sharedAction) {
            paymentLog.debug('payment.mint_quote.share.dismissed', { quoteId });
            return;
          }
          // iOS sets activityType to a UTI string identifying the chosen
          // activity (e.g. 'com.apple.UIKit.activity.AirDrop'). Android
          // always returns undefined, in which case we fall through to
          // the generic 'share' source.
          const isAirDrop = result.activityType === 'com.apple.UIKit.activity.AirDrop';
          const source = isAirDrop ? 'airdrop' : 'share';
          useTransactionDistributionStore.getState().setDistribution(quoteId, source);
          paymentLog.info('payment.mint_quote.share.success', {
            quoteId,
            entryId: entry.id,
            activityType: result.activityType ?? null,
            source,
          });
        } catch (e) {
          paymentLog.error('payment.mint_quote.share.failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  };
}
