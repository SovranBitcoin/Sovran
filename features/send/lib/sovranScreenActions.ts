/**
 * @fileoverview Sovran post-terminal screen-action handlers for colada.
 *
 * Actions offered after a payment reaches a terminal state — NFC share, emoji
 * token picker, copy, memo, recipient-pubkey injection. Each receives a colada
 * ScreenActionContext narrowed to a manager-bearing Ctx.
 */
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { paymentLog } from '@/shared/lib/logger';

import { getEncodedToken } from '@cashu/cashu-ts';
import type { Manager, SendHistoryEntry, MintHistoryEntry } from '@cashu/coco-core';
import { type ScreenActionContext, type ScreenActionHandlerMap } from '@sovranbitcoin/colada';

import { getMintQuotePaymentValue, getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { writeTokenToNFC, NfcError, isUserCancelError } from '@/shared/lib/nfc';
import {
  copyPopup,
  emojiPickerPopup,
  nfcConnectionLostPopup,
  nfcEcashSharedPopup,
  nfcSendFailedPopup,
} from '@/shared/lib/popup';
import { setDistributionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';

type Ctx<E> = ScreenActionContext<E> & { manager: Manager };

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
