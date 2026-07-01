/**
 * @fileoverview Sovran payment flow config — single source for colada glue
 *
 * Factory functions that inject Sovran-specific behavior into colada:
 * - createSovranNotifications: error/notification popups + state updates
 * - createSovranHandlers: step handlers (navigation, popups, dismiss)
 * - createSovranScreenActionHandlers: post-terminal actions (NFC, emoji token picker)
 * - createSovranScanSources: scan input sources (clipboard, gallery, NFC)
 *
 * Operations (executeSend, executeMelt, buildMintListItems, etc.) are now built-in
 * via createColada in the library.
 */

import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { paymentLog } from '@/shared/lib/logger';
import { mintLocalId } from '@/shared/lib/id';

import { getEncodedToken, getTokenMetadata } from '@cashu/cashu-ts';
import type {
  HistoryEntry,
  Manager,
  MeltHistoryEntry,
  SendHistoryEntry,
  MintHistoryEntry,
  ReceiveHistoryEntry,
} from '@cashu/coco-core';
import {
  classifyMeshRedeemError,
  isSendTokenCancelled,
  isSendTokenComplete,
  withTimeout,
  type MachineOperations,
  type NotificationHandlerMap,
  type PaymentMachine,
  type ScanSources,
  type ScreenActionContext,
  type ScreenActionHandlerMap,
  type StepHandlerMap,
  type NfcIOAdapter,
  rawAnnotationKey,
} from 'wallet';

import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import { prepareBolt11MintQuote } from '@/shared/lib/cashu/cocoOperations';
import { getMintQuotePaymentValue, getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import {
  getP2PKImportExtension,
  resolvePrimaryReceiveP2PKPublicKey,
} from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { decode, isEncoded } from '@/shared/lib/third-party/emoji';
import { writeTokenToNFC, NfcError, isUserCancelError, isAmbientNfcCycle } from '@/shared/lib/nfc';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import {
  copyPopup,
  emojiPickerPopup,
  nfcConnectionLostPopup,
  nfcEcashSharedPopup,
  nfcSendFailedPopup,
  paymentCancelledPopup,
  paymentFallbackPopup,
  paymentOptionsPopup,
  paymentStatusPopup,
  proofSelectorPopup,
  sendMemoPopup,
  staticPopup,
  paramPopup,
} from '@/shared/lib/popup';
import { RECEIVE_PENDING_TOAST_COPY } from '@/shared/lib/popup/paymentStatusCopy';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { executeRoutstrTopUp, formatRoutstrBalance } from '@/shared/lib/routstr/topUp';
import { sendBLEPrivateMessageWhole } from '@/features/bitchat/lib/blePrivateDelivery';
import { getBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { getBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import type { BitchatBLEIdentityMaterial } from 'bitchat-module';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { getNpcAddress } from '@/shared/lib/cashu/npc';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import {
  linkTransactionAnnotation,
  setDistributionAnnotation,
  setTransactionAnnotation,
} from '@/shared/stores/profile/transactionAnnotationStore';
import { useSendReachabilityStore } from '@/shared/stores/profile/sendReachabilityStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';

// =============================================================================
// createSovranExecuteReceive
// =============================================================================

type ReceiveOperationLike = {
  id: string;
  mintUrl: string;
  unit?: string;
  amount?: AmountValue;
  state: string;
  createdAt?: number;
  updatedAt?: number;
};

function isRecoverableReceiveError(err: unknown): boolean {
  const kind = classifyMeshRedeemError(err);
  return kind === 'network' || kind === 'retryable';
}

function receiveHistoryId(operationId: string): string {
  return `receive:${operationId}`;
}

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

async function findReceiveHistoryEntryForOperation(
  manager: Manager,
  operationId: string,
  mintUrl: string,
  beforeIds: Set<string>
): Promise<ReceiveHistoryEntry | null> {
  const direct = await manager.history.getHistoryEntryById(receiveHistoryId(operationId));
  if (direct?.type === 'receive') return direct as ReceiveHistoryEntry;

  const after = await manager.history.getPaginatedHistory(0, 100);
  return (
    after.find((h): h is ReceiveHistoryEntry => {
      if (h.type !== 'receive' || h.mintUrl !== mintUrl) return false;
      if (h.operationId === operationId) return true;
      return !beforeIds.has(h.id);
    }) ?? null
  );
}

async function waitForReceiveHistoryEntry(
  manager: Manager,
  operationId: string,
  mintUrl: string,
  beforeIds: Set<string>
): Promise<ReceiveHistoryEntry | null> {
  const MAX_ATTEMPTS = 50; // ~10s of polling at 200ms intervals
  const DELAY_MS = 200;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const entry = await findReceiveHistoryEntryForOperation(
        manager,
        operationId,
        mintUrl,
        beforeIds
      );
      if (entry) {
        paymentLog.info('payment.execute_receive.found', {
          ...mintUrlLogFields(mintUrl),
          realId: entry.id,
          operationId,
          attempts: attempt + 1,
        });
        return entry;
      }
    } catch (e) {
      paymentLog.warn('payment.execute_receive.poll_failed', {
        attempt,
        operationId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return null;
}

function buildPendingReceiveEntry(
  operation: ReceiveOperationLike,
  tokenString: string,
  fallbackMintUrl: string,
  fallbackAmount: number
) {
  const now = Date.now();
  const mintUrl = operation.mintUrl || fallbackMintUrl;
  const amount = amountToNumber(operation.amount ?? fallbackAmount);
  const unit = operation.unit ?? 'sat';

  return {
    id: `receive-${operation.id}`,
    type: 'receive' as const,
    createdAt: operation.createdAt ?? now,
    updatedAt: operation.updatedAt ?? now,
    mintUrl,
    unit,
    amount,
    state: 'executing',
    operationId: operation.id,
    metadata: {
      rawToken: tokenString,
      operationId: operation.id,
      pendingReason: 'network',
    },
  };
}

function buildFallbackFinalizedReceiveEntry(
  tokenString: string,
  mintUrl: string,
  amount: number,
  operationId?: string
) {
  let tokenAmount = amount;
  let tokenUnit = 'sat';
  try {
    const metadata = getTokenMetadata(tokenString);
    tokenAmount = amountToNumber(metadata.amount);
    tokenUnit = metadata.unit ?? 'sat';
  } catch (error) {
    paymentLog.warn('payment.execute_receive.fallback_decode_failed', {
      ...mintUrlLogFields(mintUrl),
      operationId: operationId ?? null,
      tokenLength: tokenString.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const now = Date.now();
  return {
    id: mintLocalId('redeemed'),
    type: 'receive' as const,
    source: 'legacy' as const,
    legacyHistoryId: mintLocalId('redeemed'),
    createdAt: now,
    updatedAt: now,
    mintUrl,
    unit: tokenUnit,
    amount: tokenAmount,
    state: 'finalized',
    ...(operationId ? { operationId } : {}),
    metadata: { rawToken: tokenString, ...(operationId ? { operationId } : {}) },
  };
}

/**
 * Sovran-side override for colada's default `executeReceive`.
 *
 * Why this exists:
 *
 * colada's default `executeReceive` calls `mgr.wallet.receive(token)`, which
 * hides Coco's operation lifecycle behind a single promise. That makes a
 * recoverable offline receive look like a terminal receive failure to the UI.
 *
 * We still need the older real-id safeguard too: if the receive finalizes
 * immediately, never let a synthesized id flow through setEntry,
 * linkTransaction, onReceiveConfirmed, or onTransactionCreated.
 *
 * The fix is to use Coco receive ops directly. If the operation reaches
 * `executing` and the mint/network is unreachable, we return Colada's
 * pending result so the screen can wait for recovery. If it finalizes
 * immediately, we still poll Coco history and use its real persisted id.
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
        (beforeHistory as readonly Record<string, unknown>[])
          .filter((h) => h.type === 'receive' && h.mintUrl === mintUrl)
          .map((h) => (typeof h.id === 'string' ? h.id : ''))
          .filter((id) => id.length > 0)
      );
    } catch (e) {
      paymentLog.warn('payment.execute_receive.snapshot_failed', {
        ...mintUrlLogFields(mintUrl),
        error: e instanceof Error ? e.message : String(e),
      });
      beforeIds = new Set();
    }

    // P2PK detection — preserved from coco's default so the downstream
    // onP2PKReceiveCompleted notification still fires for users with
    // `regenerateP2PKOnReceive` enabled.
    let hadP2PKProofs = false;
    try {
      const metadata = getTokenMetadata(tokenString);
      hadP2PKProofs = metadata.incompleteProofs.some((p) => {
        try {
          const parsed = JSON.parse(p.secret);
          return Array.isArray(parsed) && parsed[0] === 'P2PK';
        } catch {
          return false;
        }
      });
    } catch (error) {
      paymentLog.warn('payment.execute_receive.p2pk_detection_decode_failed', {
        ...mintUrlLogFields(mintUrl),
        tokenLength: tokenString.length,
        error: error instanceof Error ? error.message : String(error),
      });
      // proof decode failure — fall back to false (no regression)
    }

    paymentLog.info('payment.execute_receive.start', {
      ...mintUrlLogFields(mintUrl),
      beforeCount: beforeIds.size,
      tokenLength: tokenString.length,
      hadP2PKProofs,
      expectedNext: 'prepare_receive_operation',
    });

    const prepared = await manager.ops.receive.prepare({ token: tokenString });
    paymentLog.info('payment.execute_receive.prepared', {
      ...mintUrlLogFields(mintUrl),
      operationId: prepared.id,
      expectedNext: 'execute_or_mark_pending',
    });

    try {
      const finalized = await manager.ops.receive.execute(prepared);
      paymentLog.info('payment.execute_receive.executed', {
        ...mintUrlLogFields(finalized.mintUrl),
        operationId: finalized.id,
        state: finalized.state,
        expectedNext: 'history_entry_link',
      });
      const entry = await waitForReceiveHistoryEntry(
        manager,
        finalized.id,
        finalized.mintUrl,
        beforeIds
      );
      if (entry) {
        paymentLog.info('payment.execute_receive.finalized', {
          ...mintUrlLogFields(entry.mintUrl),
          operationId: finalized.id,
          receiveEntryId: entry.id,
          hadP2PKProofs,
          expectedNext: 'colada_receive_success',
        });
        return {
          status: 'finalized',
          historyEntry: JSON.stringify(entry),
          hadP2PKProofs,
        };
      }

      paymentLog.error('payment.execute_receive.timeout_fallback', {
        ...mintUrlLogFields(mintUrl),
        operationId: finalized.id,
        polledMs: 10_000,
      });
      const fallbackEntry = buildFallbackFinalizedReceiveEntry(
        tokenString,
        finalized.mintUrl,
        amountToNumber(finalized.amount),
        finalized.id
      );
      return {
        status: 'finalized',
        historyEntry: JSON.stringify(fallbackEntry),
        hadP2PKProofs,
      };
    } catch (err) {
      let latest: ReceiveOperationLike | null = null;
      try {
        latest = (await manager.ops.receive.get(prepared.id)) as ReceiveOperationLike | null;
      } catch (getErr) {
        paymentLog.warn('payment.execute_receive.get_after_error_failed', {
          operationId: prepared.id,
          error: getErr instanceof Error ? getErr.message : String(getErr),
        });
      }

      if (latest?.state === 'finalized') {
        const entry = await waitForReceiveHistoryEntry(
          manager,
          latest.id,
          latest.mintUrl,
          beforeIds
        );
        if (entry) {
          paymentLog.info('payment.execute_receive.finalized_after_error', {
            ...mintUrlLogFields(entry.mintUrl),
            operationId: latest.id,
            receiveEntryId: entry.id,
            hadP2PKProofs,
            expectedNext: 'colada_receive_success',
          });
          return {
            status: 'finalized',
            historyEntry: JSON.stringify(entry),
            hadP2PKProofs,
          };
        }
      }

      if (latest?.state === 'executing' && isRecoverableReceiveError(err)) {
        paymentLog.info('payment.execute_receive.pending_recovery', {
          ...mintUrlLogFields(latest.mintUrl),
          operationId: latest.id,
          hadP2PKProofs,
          pendingReason: 'network',
          expectedNext: 'coco_recovery_then_success_toast',
          error: err instanceof Error ? err.message : String(err),
        });
        const pendingEntry = buildPendingReceiveEntry(latest, tokenString, mintUrl, _amount);
        return {
          status: 'pending',
          operationId: latest.id,
          historyEntry: JSON.stringify(pendingEntry),
          pendingReason: 'network',
          message: RECEIVE_PENDING_TOAST_COPY.subtitle,
          hadP2PKProofs,
        };
      }

      paymentLog.error('payment.execute_receive.failed_terminal', {
        ...mintUrlLogFields(mintUrl),
        operationId: prepared.id,
        latestState: latest?.state ?? null,
        hadP2PKProofs,
        error: err instanceof Error ? err.message : String(err),
        expectedNext: 'colada_receive_failed',
      });
      throw err;
    }
  };
}

// =============================================================================
// createSovranExecuteMintQuote
// =============================================================================

const MINT_QUOTE_PREPARE_TIMEOUT_MS = 10_000;

/**
 * Sovran-side override for colada's default `executeMintQuote`.
 *
 * colada's default (defaultOperations.ts:275) calls
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
 * the LightningReceiveScreen still has a lightning invoice to display.
 */
export function createSovranExecuteMintQuote(
  getManager: () => Manager | null
): NonNullable<MachineOperations['executeMintQuote']> {
  return async (mintUrl, amount, _unit, method = 'bolt11') => {
    const manager = getManager();
    if (!manager) {
      paymentLog.error('payment.execute_mint_quote.no_manager');
      throw new Error('Wallet manager is not available');
    }

    if (method === 'onchain') {
      throw new Error('Onchain mint quotes are not supported by @cashu/coco-core 1.0.1');
    }

    // Snapshot existing mint ids for this mint URL so we can detect the
    // newly-persisted row by set difference if quoteId matching fails.
    let beforeIds: Set<string>;
    try {
      const beforeHistory: HistoryEntry[] = await manager.history.getPaginatedHistory(0, 100);
      beforeIds = new Set(
        beforeHistory.filter((h) => h.type === 'mint' && h.mintUrl === mintUrl).map((h) => h.id)
      );
    } catch (e) {
      paymentLog.warn('payment.execute_mint_quote.snapshot_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      beforeIds = new Set();
    }

    paymentLog.info('payment.execute_mint_quote.start', {
      ...mintUrlLogFields(mintUrl),
      amount,
    });
    const mintOp = await withTimeout(
      prepareBolt11MintQuote(manager, mintUrl, amount, _unit),
      MINT_QUOTE_PREPARE_TIMEOUT_MS,
      'executeMintQuote.prepare'
    );
    paymentLog.info('payment.execute_mint_quote.prepared', {
      operationId: mintOp.id,
      quoteId: mintOp.quoteId,
    });

    // Constructed entry — used as a fallback (same shape as coco's default
    // executeMintQuote) when polling can't find coco's persisted row in time.
    const constructedEntry: MintHistoryEntry = {
      id: mintOp.id,
      type: 'mint',
      operationId: mintOp.id,
      createdAt: mintOp.createdAt,
      mintUrl: mintOp.mintUrl,
      unit: mintOp.unit,
      quoteId: mintOp.quoteId,
      state: mintOp.lastObservedRemoteState ?? 'UNPAID',
      amount: mintOp.amount,
      paymentRequest: mintOp.request,
      metadata: { operationId: mintOp.id },
    };

    // Poll for coco's persisted row. Prefer quoteId match (deterministic);
    // fall back to id-diff against the pre-prepare snapshot.
    const MAX_ATTEMPTS = 50; // ~10s of polling at 200ms intervals
    const DELAY_MS = 200;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const after: HistoryEntry[] = await manager.history.getPaginatedHistory(0, 100);
        const persisted = after.find((h): h is MintHistoryEntry => {
          if (h.type !== 'mint' || h.mintUrl !== mintUrl) return false;
          // Preferred: deterministic quoteId match
          if (mintOp.quoteId && h.quoteId === mintOp.quoteId) return true;
          // Fallback: set difference on ids
          return !beforeIds.has(h.id);
        });
        if (persisted) {
          paymentLog.info('payment.execute_mint_quote.found', {
            ...mintUrlLogFields(mintUrl),
            persistedId: persisted.id,
            constructedId: mintOp.id,
            matchedById: persisted.id === mintOp.id,
            attempts: attempt + 1,
          });
          // Coco's persisted row is authoritative — its `id` is what flows
          // downstream to onTransactionCreated and the scan-history link.
          return { historyEntry: JSON.stringify(persisted) };
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
      ...mintUrlLogFields(mintUrl),
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

// =============================================================================
// createSovranHandlers
// =============================================================================

interface CreateSovranHandlersConfig {
  machine: PaymentMachine;
  onOptionDismiss?: () => void;
  getManager: () => Manager | null;
  getNpub?: () => string | undefined;
  getBitchatIdentityMaterial?: () => BitchatBLEIdentityMaterial | null;
  /**
   * Deliver a bearer ecash token to a remote Nostr contact over an encrypted
   * NIP-17 gift-wrapped DM. Provided by the Colada provider (which holds the
   * nostr keys + NDK). When a contact send completes and this is wired, the
   * token is DM'd to the contact instead of shown on the bearer hand-off
   * screen. Rejects when not delivered — the caller keeps the funds
   * recoverable by falling back to the hand-off screen.
   */
  deliverContactEcashDm?: (params: { recipientPubkey: string; token: string }) => Promise<void>;
}

function getEncodedEcashTokenFromSendHistoryEntry(historyEntry: string): string | null {
  try {
    const parsed = JSON.parse(historyEntry) as {
      token?: Parameters<typeof getEncodedToken>[0];
      tokenString?: unknown;
      metadata?: { rawToken?: unknown };
    };
    if (typeof parsed.tokenString === 'string' && parsed.tokenString.length > 0) {
      return parsed.tokenString;
    }
    if (typeof parsed.metadata?.rawToken === 'string' && parsed.metadata.rawToken.length > 0) {
      return parsed.metadata.rawToken;
    }
    if (parsed.token) {
      return getEncodedToken(parsed.token);
    }
  } catch (err) {
    paymentLog.warn('near_pay.token.extract_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

async function deliverNearPayIfActive(
  historyEntry: string,
  getBitchatIdentityMaterial?: () => BitchatBLEIdentityMaterial | null
): Promise<void> {
  const active = useNearPaySessionStore.getState().active;
  if (!active) return;

  // Every Nut Drop send is delivered as a SINGLE private Noise DM to a
  // creq-confirmed Sovran peer — encrypted to them, so a locked OR offline
  // bearer token stays private (no public-mesh broadcast of payment metadata).
  // The whole multi-KB token fits one message thanks to the extended
  // PrivateMessagePacket length. Stock clients can't decode extended DMs, so
  // active sessions must carry a creq capability proof before we transmit.

  try {
    const encodedToken = getEncodedEcashTokenFromSendHistoryEntry(historyEntry);
    if (!encodedToken) throw new Error('Created send entry did not contain an ecash token');
    if (!active.recipient.creq) {
      throw new Error('Nut Drop recipient has not advertised a creq capability');
    }

    const profileScope = getBitchatProfileScope();
    const identityMaterial = getBitchatIdentityMaterial?.() ?? null;
    const nickname = getBitchatNickname() || 'sovran';
    const result = await sendBLEPrivateMessageWhole({
      peerID: active.recipient.peerID,
      content: encodedToken,
      nickname,
      profileScope,
      identityMaterial,
    });

    paymentLog.info('near_pay.delivery.sent', {
      peerID: active.recipient.peerID,
      tokenBytes: encodedToken.length,
      hasDirectLink: active.recipient.hasDirectLink,
      startupMs: Math.round(result.startupMs * 100) / 100,
      handshakeMs: Math.round(result.handshakeMs * 100) / 100,
      sendMs: Math.round(result.sendMs * 100) / 100,
      ...(result.handshakeError ? { handshakeError: result.handshakeError } : {}),
    });

    // Delivered over the BLE/bitchat mesh — stamp a bluetooth source badge on
    // the resulting send transaction.
    try {
      const entry = JSON.parse(historyEntry) as { id?: unknown };
      if (typeof entry.id === 'string') {
        setTransactionAnnotation(`id:${entry.id}`, { scan: { method: 'ble' } });
      }
    } catch (e) {
      paymentLog.warn('near_pay.delivery.ble_source_annotation_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (err) {
    paymentLog.error('near_pay.delivery.failed', {
      peerID: active.recipient.peerID,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    useNearPaySessionStore.getState().complete();
  }
}

/**
 * Deliver a just-created bearer ecash token to a remote Nostr contact when a
 * destination-first Send was addressed to one (`contactSendStore`). The token
 * rides an encrypted NIP-17 gift-wrapped DM to the contact's npub — bearer is
 * safe here because only that npub can decrypt it (unlike the public mesh).
 *
 * Returns true only when the token was handed to a relay; on any failure it
 * returns false WITHOUT clearing the target, so the caller falls back to the
 * bearer hand-off screen and the funds stay recoverable. Always clears the
 * target on success so a later ordinary send never re-DMs to a stale contact.
 */
async function deliverContactDmIfActive(
  historyEntry: string,
  deliverContactEcashDm?: CreateSovranHandlersConfig['deliverContactEcashDm']
): Promise<boolean> {
  const target = useContactSendStore.getState().active;
  if (!target) return false;
  if (!deliverContactEcashDm) {
    paymentLog.warn('contact_send.delivery.no_adapter');
    return false;
  }

  try {
    const encodedToken = getEncodedEcashTokenFromSendHistoryEntry(historyEntry);
    if (!encodedToken) throw new Error('Created send entry did not contain an ecash token');

    await deliverContactEcashDm({ recipientPubkey: target.pubkey, token: encodedToken });
    paymentLog.info('contact_send.delivery.sent', { tokenBytes: encodedToken.length });

    // The recipient identity (avatar/name) is already stamped on the
    // transaction via the counterparty annotation in the `sendComplete`
    // handler, so no extra source badge is needed here.
    useContactSendStore.getState().clear();
    return true;
  } catch (err) {
    // Do NOT clear the target or the token — fall back to the bearer hand-off
    // screen so the user can still deliver (copy/share) the funds manually.
    paymentLog.error('contact_send.delivery.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function createSovranHandlers({
  machine,
  onOptionDismiss,
  getManager,
  getNpub,
  getBitchatIdentityMaterial,
  deliverContactEcashDm,
}: CreateSovranHandlersConfig): StepHandlerMap {
  paymentLog.debug('payment.handlers.created');

  return {
    selectDestination: ({ unit }) => {
      paymentLog.info('payment.step.select_destination', { unit });
      router.navigate({ pathname: '/(send-flow)/send', params: { unit } });
    },

    receiveToken: ({ token }) => {
      paymentLog.info('payment.step.receive_token');
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    sendComplete: async ({
      historyEntry,
      createdOffline,
      mintWasOffline,
      recipientPubkey,
      recipientProfile,
      p2pkLockPubkey,
    }) => {
      paymentLog.info('payment.step.send_complete', {
        createdOffline: !!createdOffline,
        mintWasOffline: !!mintWasOffline,
        recipientPubkeyPresent: !!recipientPubkey,
        p2pkLocked: !!p2pkLockPubkey,
      });

      // Routstr top-up: intercept the token and send it to the Routstr API
      const topUpState = useRoutstrTopUpStore.getState();
      if (topUpState.active) {
        try {
          const entry = JSON.parse(historyEntry);
          const encodedToken = getEncodedToken(entry.token);
          const result = await executeRoutstrTopUp(encodedToken);

          if (result.success) {
            const balanceStr = formatRoutstrBalance(result.balance);
            if (result.isNewWallet) {
              paramPopup('routstr-wallet-created', { balance: balanceStr });
            } else {
              paramPopup('routstr-top-up-success', { balance: balanceStr });
            }
            useRoutstrTopUpStore.getState().complete('success');
          } else {
            staticPopup('routstr-transaction-failed', { text: result.error });
            useRoutstrTopUpStore.getState().complete('failed');
          }
        } catch (e) {
          paymentLog.error('payment.routstr_topup.error', {
            error: e instanceof Error ? e.message : String(e),
          });
          staticPopup('routstr-transaction-failed', { text: 'Failed to process top-up' });
          useRoutstrTopUpStore.getState().complete('failed');
        }
        router.dismiss();
        return;
      }

      // Inject recipientPubkey into the executed history entry's metadata
      // so SendTokenScreen can render the recipient identity. Operations
      // build the entry; we attach identity at the screen-handler seam.
      const enrichedHistoryEntry = recipientPubkey
        ? injectRecipientPubkey(historyEntry, recipientPubkey)
        : historyEntry;

      // Persist the recipient's nostr identity as a counterparty annotation so
      // the transactions row + detail show their avatar (the transient
      // metadata injection above only survives this navigation).
      if (recipientPubkey) {
        try {
          const entry = JSON.parse(enrichedHistoryEntry) as { id?: unknown };
          if (typeof entry.id === 'string') {
            setTransactionAnnotation(`id:${entry.id}`, {
              counterparty: {
                pubkey: recipientPubkey,
                direction: 'recipient',
                ...(recipientProfile?.displayName
                  ? { displayName: recipientProfile.displayName }
                  : {}),
                ...(recipientProfile?.avatarUrl ? { avatarUrl: recipientProfile.avatarUrl } : {}),
                ...(recipientProfile?.nip05 ? { nip05: recipientProfile.nip05 } : {}),
              },
            });
          }
        } catch (e) {
          paymentLog.warn('payment.send_complete.counterparty_annotation_failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (createdOffline) {
        try {
          const entry = JSON.parse(enrichedHistoryEntry) as { id?: unknown; mintUrl?: unknown };
          if (typeof entry.id === 'string' && typeof entry.mintUrl === 'string') {
            useSendReachabilityStore.getState().markChecking(entry.id, entry.mintUrl);
            useSendReachabilityStore.getState().pruneOld();
          }
        } catch (e) {
          paymentLog.warn('payment.send_complete.reachability_seed_failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      await deliverNearPayIfActive(enrichedHistoryEntry, getBitchatIdentityMaterial);

      // Remote-contact ecash: deliver the bearer token over an encrypted Nostr
      // DM and drop the user into that chat thread (the self-copy wrap surfaces
      // the sent token bubble), instead of the bearer hand-off screen. A P2PK
      // lock means this was a Nut Drop, not a contact DM — leave those alone.
      const contactTarget = useContactSendStore.getState().active;
      if (contactTarget && !p2pkLockPubkey) {
        const recipientPubkey = contactTarget.pubkey;
        const delivered = await deliverContactDmIfActive(
          enrichedHistoryEntry,
          deliverContactEcashDm
        );
        if (delivered) {
          router.dismissAll();
          router.navigate({ pathname: '/userMessages', params: { pubkey: recipientPubkey } });
          return;
        }
        // Delivery failed — fall through to the bearer hand-off screen so the
        // user can still copy/share the token (funds are not lost).
        paymentLog.warn('contact_send.delivery.fallback_to_hand_off');
      }

      router.navigate({
        pathname: '/(send-flow)/sendToken',
        params: {
          sendHistoryEntry: enrichedHistoryEntry,
          ...(createdOffline ? { createdOffline: 'true' } : {}),
          ...(mintWasOffline ? { mintWasOffline: 'true' } : {}),
        },
      });
    },

    navigateToPaymentRequest: ({ mintUrl, paymentRequest, amount, unit, recipientPubkey }) => {
      paymentLog.info('payment.step.navigate_payment_request', {
        ...mintUrlLogFields(mintUrl),
        amount,
        unit,
        recipientPubkeyPresent: !!recipientPubkey,
        paymentRequestLength: paymentRequest.length,
      });
      const entry = {
        id: mintLocalId('pr-preview'),
        type: 'send',
        createdAt: Date.now(),
        mintUrl,
        amount,
        unit,
        state: 'prepared',
        metadata: {
          paymentRequest,
          phase: 'preview',
          ...(recipientPubkey ? { recipientPubkey } : {}),
        },
      };
      const isFallback = (machine.getContext().failedOptionValues?.length ?? 0) > 0;
      const nav = isFallback ? router.replace : router.navigate;
      nav({
        pathname: '/(send-flow)/paymentRequest',
        params: { paymentRequestEntry: JSON.stringify(entry) },
      });
    },

    navigateToMeltPreview: ({
      mintUrl,
      meltTarget,
      amount,
      unit,
      recipientPubkey,
      recipientProfile,
    }) => {
      paymentLog.info('payment.step.navigate_melt_preview', {
        ...mintUrlLogFields(mintUrl),
        amount,
        unit,
        meltTargetLength: meltTarget.length,
        recipientPubkeyPresent: !!recipientPubkey,
        recipientProfilePresent: !!recipientProfile,
        recipientProfileDisplayName: recipientProfile?.displayName ?? null,
        recipientProfileAvatarUrlPresent: !!recipientProfile?.avatarUrl,
      });
      // `MeltHistoryEntry.metadata` is typed `Record<string, string>` upstream
      // in `@cashu/coco-core`, so the resolved profile is flattened into
      // individual string keys instead of stored as a nested object.
      // `LightningSendScreen` re-assembles them on read.
      const id = mintLocalId('melt-preview');
      const now = Date.now();
      const entry: MeltHistoryEntry & {
        source: 'legacy';
        legacyHistoryId: string;
        updatedAt: number;
      } = {
        id,
        type: 'melt',
        source: 'legacy',
        legacyHistoryId: id,
        createdAt: now,
        updatedAt: now,
        mintUrl,
        unit: unit ?? 'sat',
        quoteId: '',
        state: 'UNPAID',
        amount: amountToNumber(amount),
        metadata: {
          phase: 'preview',
          meltTarget,
          ...(recipientPubkey ? { recipientPubkey } : {}),
          ...(recipientProfile?.displayName
            ? { recipientDisplayName: recipientProfile.displayName }
            : {}),
          ...(recipientProfile?.avatarUrl
            ? { recipientAvatarUrl: recipientProfile.avatarUrl }
            : {}),
          ...(recipientProfile?.nip05 ? { recipientNip05: recipientProfile.nip05 } : {}),
        },
      };
      const isFallback = (machine.getContext().failedOptionValues?.length ?? 0) > 0;
      const nav = isFallback ? router.replace : router.navigate;
      nav({
        pathname: '/(send-flow)/lightningSend',
        params: { meltHistoryEntry: JSON.stringify(entry) },
      });
    },

    mintQuoteCreated: ({ historyEntry, unit }) => {
      let pathname: '/(receive-flow)/lightningReceive' | '/(receive-flow)/onchainReceive' =
        '/(receive-flow)/lightningReceive';
      try {
        pathname = getOnchainMintAddress(JSON.parse(historyEntry) as HistoryEntry)
          ? '/(receive-flow)/onchainReceive'
          : '/(receive-flow)/lightningReceive';
      } catch {
        pathname = '/(receive-flow)/lightningReceive';
      }
      router.replace({
        pathname,
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
      router.navigate(buildModalProfileHref({ npub }));
    },

    navigateToReceive: async ({ unit, methodContext }) => {
      const t0 = performance.now();
      const npub = getNpub?.();
      const selectedMintUrl = useNpcMintStore.getState().getActiveMintUrl();

      let p2pkKey: string | undefined;
      const currentMgr = getManager();
      if (currentMgr) {
        try {
          p2pkKey = await resolvePrimaryReceiveP2PKPublicKey(currentMgr);
        } catch {
          /* ignore */
        }
      }

      const entry = {
        type: 'receive',
        id: 'receive-hub',
        createdAt: Date.now(),
        mintUrl: selectedMintUrl ?? '',
        npcAddress: npub ? getNpcAddress(undefined, npub) : undefined,
        p2pkKey,
        selectedMintUrl,
        ...(methodContext ? { methodContext } : {}),
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
        ...(constraints.methodContext ? { methodContext: constraints.methodContext } : {}),
        // Snapshot the machine-resolved recipient identity onto the entry so
        // the amount screen renders "Pay <name>" + avatar on first paint
        // when the resolver beat the navigation. AmountFlowScreen also
        // subscribes to the live ctx for the case where the resolver lands
        // after navigation.
        ...(constraints.recipientPubkey ? { recipientPubkey: constraints.recipientPubkey } : {}),
        ...(constraints.recipientProfile ? { recipientProfile: constraints.recipientProfile } : {}),
      };
      const params = { amountEntry: JSON.stringify(entry) };
      const nearPaySessionStore = useNearPaySessionStore.getState();
      // Radar-launched sends stay inline on the radar: the vanilla ladder
      // arrives as destination 'sendEcash', mesh sends as 'paymentRequest'
      // (the solicited creq rides the payment-request machinery).
      if (
        nearPaySessionStore.active &&
        (constraints.destination === 'sendEcash' || constraints.destination === 'paymentRequest')
      ) {
        nearPaySessionStore.setAmountEntry(params.amountEntry);
        paymentLog.info('navigate.enterAmount.near_pay_inline', {
          destination: constraints.destination,
          duration_ms: performance.now() - t0,
        });
        return;
      }
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
      mintQuoteMethod,
      meltQuoteMethod,
      methodRequirement,
      mintListItems,
      scope,
    }) => {
      const entry = {
        items: mintListItems ?? [],
        scope: scope ?? 'selected',
        destination,
        ...(mintQuoteMethod ? { mintQuoteMethod } : {}),
        ...(meltQuoteMethod ? { meltQuoteMethod } : {}),
        ...(methodRequirement ? { methodRequirement } : {}),
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

    enterSendMemo: (stepData) => {
      sendMemoPopup({ ...stepData, machine });
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

/**
 * Re-serialize a JSON-encoded coco history entry with `recipientPubkey`
 * added to its metadata. Returns the input unchanged if it can't be parsed
 * — operations build the entry, this only attaches identity at the seam.
 */
function injectRecipientPubkey(historyEntry: string, recipientPubkey: string): string {
  try {
    const parsed = JSON.parse(historyEntry) as { metadata?: Record<string, unknown> };
    parsed.metadata = { ...(parsed.metadata ?? {}), recipientPubkey };
    return JSON.stringify(parsed);
  } catch {
    paymentLog.warn('payment.recipient_pubkey.inject_failed');
    return historyEntry;
  }
}

function sendCtx(ctx: ScreenActionContext): Ctx<SendHistoryEntry> {
  return ctx as Ctx<SendHistoryEntry>;
}

function mintQuoteCtx(ctx: ScreenActionContext): Ctx<MintHistoryEntry> {
  return ctx as Ctx<MintHistoryEntry>;
}

/**
 * App-specific screen action overrides. Only actions that require platform
 * primitives not available in colada (NFC writer, emoji picker).
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
          await writeTokenToNFC(getEncodedToken(entry.token));
          paymentLog.info('payment.screen_action.nfc.success');
          nfcEcashSharedPopup();
          return;
        } catch (rawError) {
          // User dismissed the system NFC sheet — no popup, no rollback;
          // the send op was never committed to the wire.
          if (isUserCancelError(rawError)) {
            paymentLog.info('payment.screen_action.nfc.user_cancel');
            return;
          }
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
       * `'text'` or `'emoji'`. An omitted `variantId` uses the text path.
       */
      copy: async (rawCtx) => {
        const { entry } = sendCtx(rawCtx);
        if (!entry.token) return;
        // `ScreenActionContext` carries action params via the `[key: string]: unknown`
        // index signature, so `rawCtx.variantId` is already typed as `unknown` —
        // narrow it directly without a cast.
        const variantId = typeof rawCtx.variantId === 'string' ? rawCtx.variantId : 'text';
        if (variantId === 'emoji') {
          emojiPickerPopup({ token: getEncodedToken(entry.token) });
          return;
        }
        // Default — text clipboard copy.
        try {
          await Clipboard.setStringAsync(getEncodedToken(entry.token));
          copyPopup('token');
          paymentLog.info('payment.send_token.copy.text.success', { entryId: entry.id });
        } catch (e) {
          paymentLog.error('payment.send_token.copy.failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },

    // ── mintQuote (Lightning receive) ────────────────────────────────
    //
    // We override copy/share so we can record the *outbound distribution*
    // method for the resulting transaction. The other wallet's payment
    // method is unknowable, but we can capture which channel WE used to
    // share the lightning invoice. The 'displayed' fallback is written by
    // a global subscription in Colada.tsx when the quote transitions
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
        const paymentValue = getMintQuotePaymentValue(entry);
        const quoteId = entry.quoteId;
        if (!paymentValue || !quoteId) {
          paymentLog.warn('payment.mint_quote.copy.no_payment_request', {
            hasPaymentRequest: !!paymentValue,
            hasQuoteId: !!quoteId,
          });
          return;
        }
        try {
          await Clipboard.setStringAsync(paymentValue);
          useTransactionDistributionStore.getState().setDistribution(quoteId, 'copy');
          setDistributionAnnotation(`quote:${quoteId}`, 'copy');
          paymentLog.info('payment.mint_quote.copy.success', {
            quoteId,
            entryId: entry.id,
          });
          copyPopup(getOnchainMintAddress(entry) ? 'address' : 'lightningInvoice');
        } catch (e) {
          paymentLog.error('payment.mint_quote.copy.failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },

      share: async (rawCtx) => {
        const { entry } = mintQuoteCtx(rawCtx);
        const paymentValue = getMintQuotePaymentValue(entry);
        const quoteId = entry.quoteId;
        if (!paymentValue || !quoteId) {
          paymentLog.warn('payment.mint_quote.share.no_payment_request', {
            hasPaymentRequest: !!paymentValue,
            hasQuoteId: !!quoteId,
          });
          return;
        }
        try {
          // Read the share result so we can detect AirDrop on iOS. The
          // provider share adapter intentionally returns void, so this
          // action override owns the result inspection.
          const result = await Share.share({ message: paymentValue });
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
          setDistributionAnnotation(`quote:${quoteId}`, source);
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
