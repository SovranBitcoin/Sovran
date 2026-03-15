import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';

import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import type {
  Manager,
  SendHistoryEntry,
  MeltHistoryEntry,
  MintHistoryEntry,
} from 'coco-cashu-core';

import type { ScreenActionContext, ScreenActionHandlerMap } from 'coco-payment-ux';

import { isLightningInvoice, requestInvoiceFromLnurl } from '@/shared/lib/cashu/utils';
import { debugLog } from '@/shared/lib/debugLog';
import {
  copyPopup,
  nfcEcashSharedPopup,
  nfcConnectionLostPopup,
  nfcSendFailedPopup,
  transactionCancelledPopup,
  cancelTransactionFailedPopup,
  tokenRedeemedByRecipientPopup,
  tokenPendingNotRedeemedPopup,
  operationNotFoundPopup,
  operationInvalidStatePopup,
  transactionAlreadyCancelledPopup,
  paymentCancelledPopup,
  couldNotCancelPopup,
  paymentStatusPopup,
} from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { writeTokenToNFC } from '@/shared/lib/nfc';

// ---------------------------------------------------------------------------
// Typed context helpers — cast generic ScreenActionContext to concrete types
// ---------------------------------------------------------------------------

type Ctx<E> = ScreenActionContext<E> & { manager: Manager };

function sendCtx(ctx: ScreenActionContext): Ctx<SendHistoryEntry> {
  return ctx as Ctx<SendHistoryEntry>;
}

function mintQuoteCtx(ctx: ScreenActionContext): Ctx<MintHistoryEntry> {
  return ctx as Ctx<MintHistoryEntry>;
}

function meltQuoteCtx(ctx: ScreenActionContext): Ctx<MeltHistoryEntry> {
  return ctx as Ctx<MeltHistoryEntry>;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createSovranScreenActionHandlers(): ScreenActionHandlerMap {
  return {
    // ── Send Token ────────────────────────────────────────────────────────
    sendToken: {
      copy: async (rawCtx) => {
        const { entry } = sendCtx(rawCtx);
        if (!entry.token) return;
        await Clipboard.setStringAsync(getEncodedTokenV4(entry.token));
        copyPopup('ecashToken');
      },

      share: async (rawCtx) => {
        const { entry } = sendCtx(rawCtx);
        if (!entry.token) return;
        await Share.share({ message: 'cashu://' + getEncodedTokenV4(entry.token) });
      },

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

      copyAsEmoji: async () => {
        // copyAsEmoji is handled as a pushSheet at the screen level.
        // This handler is a no-op; the screen wires pushSheet directly.
      },

      checkStatus: async (rawCtx) => {
        const { entry, manager } = sendCtx(rawCtx);
        if (!entry.operationId) return;

        const operation = await manager.send.getOperation(entry.operationId);
        if (!operation) {
          operationNotFoundPopup();
          return;
        }

        if (operation.state === 'finalized') {
          tokenRedeemedByRecipientPopup();
          return;
        }

        if (operation.state === 'rolled_back') {
          transactionAlreadyCancelledPopup();
          return;
        }

        if (operation.state !== 'pending') {
          operationInvalidStatePopup({ state: operation.state });
          return;
        }

        await manager.send.checkPendingOperation(entry.operationId);

        const updatedOperation = await manager.send.getOperation(entry.operationId);
        if (updatedOperation?.state === 'finalized') {
          tokenRedeemedByRecipientPopup();
        } else {
          tokenPendingNotRedeemedPopup();
        }
      },

      cancel: async (rawCtx) => {
        const { entry, manager } = sendCtx(rawCtx);
        if (!entry.operationId) return;

        try {
          await manager.send.rollback(entry.operationId);
          transactionCancelledPopup();
        } catch (error) {
          cancelTransactionFailedPopup({
            text: error instanceof Error ? error.message : undefined,
          });
        }
      },
    },

    // ── Receive Token ─────────────────────────────────────────────────────
    // Redeem is complex (payment status toast, P2PK key rotation, scan history linking).
    // It stays in the screen for now — the handler here is a placeholder that the
    // React hook overrides with a locally-constructed callback.
    receiveToken: {
      redeem: async () => {
        // Overridden at the hook/screen level (see useScreenActions + ReceiveTokenScreen).
      },
    },

    // ── Mint Quote ────────────────────────────────────────────────────────
    mintQuote: {
      copy: async (rawCtx) => {
        const { entry } = mintQuoteCtx(rawCtx);
        await Clipboard.setStringAsync(entry.paymentRequest);
        copyPopup('lightningAddress');
      },

      share: async (rawCtx) => {
        const { entry } = mintQuoteCtx(rawCtx);
        await Share.share({ message: entry.paymentRequest });
      },
    },

    // ── Melt Quote ────────────────────────────────────────────────────────
    meltQuote: {
      pay: async (rawCtx) => {
        const { entry, manager } = meltQuoteCtx(rawCtx);
        let operationId = (rawCtx as Record<string, unknown>).operationId as string | undefined;
        const isPreview = !entry.quoteId;

        debugLog({
          location: 'screenActionHandlers.meltQuote.pay',
          message: 'pay handler — entry',
          phase: 'entry',
          data: { isPreview, quoteId: entry.quoteId, operationId },
        });

        // Phase 1: Prepare (only when preview — no quote yet)
        // TODO: On prepare failure, navigate to mint selector to let user change mints
        if (isPreview) {
          const meltTarget = entry.metadata?.meltTarget;
          if (!meltTarget) throw new Error('Missing meltTarget in metadata');

          debugLog({
            location: 'screenActionHandlers.meltQuote.pay',
            message: 'preview phase — resolving bolt11',
            phase: 'before',
            data: { meltTarget, mintUrl: entry.mintUrl, amount: entry.amount },
          });

          const bolt11 = isLightningInvoice(meltTarget)
            ? meltTarget
            : await requestInvoiceFromLnurl(meltTarget, entry.amount);

          debugLog({
            location: 'screenActionHandlers.meltQuote.pay',
            message: 'bolt11 ready — calling prepareMeltBolt11',
            phase: 'before',
            data: { bolt11Len: bolt11?.length },
          });

          const operation = await manager.quotes.prepareMeltBolt11(entry.mintUrl, bolt11);
          operationId = operation.id;

          debugLog({
            location: 'screenActionHandlers.meltQuote.pay',
            message: 'prepareMeltBolt11 completed — pushing real entry for live updates',
            phase: 'after',
            data: { operationId: operation.id, quoteId: operation.quoteId },
          });

          const setEntry = (rawCtx as Record<string, unknown>).setEntry as
            | ((e: Record<string, unknown>) => void)
            | undefined;
          if (setEntry) {
            const realEntry: MeltHistoryEntry = {
              id: operation.id,
              type: 'melt',
              createdAt: Date.now(),
              mintUrl: operation.mintUrl,
              unit: entry.unit,
              quoteId: operation.quoteId,
              state: 'UNPAID',
              amount: operation.amount,
              metadata: { ...entry.metadata, phase: 'ready' },
            };
            setEntry(realEntry as unknown as Record<string, unknown>);
          }
        }

        // Phase 2: Execute
        const quoteId = isPreview ? undefined : entry.quoteId;

        const store = usePaymentStatusStore.getState();
        if (quoteId && store.active?.id === quoteId && store.active?.state === 'failed') {
          store.setActive(null);
        }
        store.setActive({
          variant: 'melt',
          id: quoteId ?? operationId ?? entry.id,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit,
          state: 'processing',
        });

        debugLog({
          location: 'screenActionHandlers.meltQuote.pay',
          message: 'payment status store set — showing popup',
          phase: 'before',
          data: { quoteId, operationId },
        });
        paymentStatusPopup({
          variant: 'melt',
          id: quoteId ?? operationId ?? entry.id,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit,
          operationId,
        });

        debugLog({
          location: 'screenActionHandlers.meltQuote.pay',
          message: operationId ? 'executeMelt by operationId' : 'executeMeltByQuote fallback',
          phase: 'before',
          data: { operationId, quoteId },
        });
        if (operationId) {
          await manager.quotes.executeMelt(operationId);
        } else if (quoteId) {
          await manager.quotes.executeMeltByQuote(entry.mintUrl, quoteId);
        }

        debugLog({
          location: 'screenActionHandlers.meltQuote.pay',
          message: 'executeMelt completed',
          phase: 'after',
          data: { quoteId, operationId },
        });
      },

      cancel: async (rawCtx) => {
        const { manager } = meltQuoteCtx(rawCtx);
        const operationId = (rawCtx as Record<string, unknown>).operationId as string | undefined;
        const entry = meltQuoteCtx(rawCtx).entry;

        debugLog({
          location: 'screenActionHandlers.meltQuote.cancel',
          message: 'cancel handler — entry',
          phase: 'entry',
          data: { quoteId: entry.quoteId, operationId, hasOperationId: !!operationId },
        });

        if (!operationId && !entry.quoteId) {
          debugLog({
            location: 'screenActionHandlers.meltQuote.cancel',
            message: 'cancel — no operationId or quoteId, skipping',
            phase: 'after',
            data: {},
          });
          return;
        }

        try {
          debugLog({
            location: 'screenActionHandlers.meltQuote.cancel',
            message: 'rollbackMelt',
            phase: 'before',
            data: { operationId },
          });
          if (operationId) {
            await manager.quotes.rollbackMelt(operationId, 'User cancelled');
          }
          debugLog({
            location: 'screenActionHandlers.meltQuote.cancel',
            message: 'rollback completed — showing paymentCancelledPopup',
            phase: 'after',
            data: {},
          });
          paymentCancelledPopup();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          debugLog({
            location: 'screenActionHandlers.meltQuote.cancel',
            message: 'rollback failed',
            phase: 'after',
            data: { error: msg },
          });
          if (
            msg.includes('Cannot rollback') ||
            msg.includes('not found') ||
            msg.includes('No melt operation')
          ) {
            return;
          }
          couldNotCancelPopup({ text: msg });
        }
      },
    },
  };
}
