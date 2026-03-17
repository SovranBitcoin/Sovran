import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';

import { router } from 'expo-router';

import { getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import type {
  Manager,
  SendHistoryEntry,
  MeltHistoryEntry,
  MintHistoryEntry,
  ReceiveHistoryEntry,
} from 'coco-cashu-core';

import { defaultDetectors } from 'coco-payment-ux';
import type { ScreenActionContext, ScreenActionHandlerMap } from 'coco-payment-ux';

import { isLightningInvoice, requestInvoiceFromLnurl } from '@/shared/lib/cashu/utils';
import {
  copyPopup,
  emojiPickerPopup,
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
  unsupportedTokenUnitPopup,
  receiveFailedPopup,
} from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
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

      copyAsEmoji: async (rawCtx) => {
        const { entry } = sendCtx(rawCtx);
        if (!entry.token) return;
        emojiPickerPopup({ token: getEncodedTokenV4(entry.token) });
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
    receiveToken: {
      redeem: async (rawCtx) => {
        const { entry, manager } = receiveTokenCtx(rawCtx);
        if (!entry.token) return;

        const tokenString = manager.wallet.encodeToken(entry.token);

        // Validate unit
        const decoded = getDecodedToken(tokenString);
        if (decoded.unit !== 'sat') {
          unsupportedTokenUnitPopup({ unit: decoded.unit ?? 'unknown' });
          return;
        }

        // Check mint trust — navigate to mint info if untrusted
        const isTrusted = await manager.mint.isTrustedMint(entry.mintUrl);
        if (!isTrusted) {
          router.navigate({
            pathname: '/(mint-flow)/info',
            params: {
              mintUrl: entry.mintUrl,
              fromAccepter: '1',
              token: tokenString,
            },
          });
          return;
        }

        // Show multi-stage payment toast
        const store = usePaymentStatusStore.getState();
        if (store.active?.id === entry.id && store.active?.state === 'failed') {
          store.setActive(null);
        }
        store.setActive({
          variant: 'receive-ecash',
          id: entry.id,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit ?? 'sat',
          state: 'processing',
        });
        paymentStatusPopup({
          variant: 'receive-ecash',
          id: entry.id,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit ?? 'sat',
        });

        try {
          await manager.wallet.receive(tokenString);

          // P2PK key rotation
          if (useSettingsStore.getState().regenerateP2PKOnReceive) {
            try {
              const hasP2PK = decoded.proofs.some((proof) => {
                try {
                  const parsed = JSON.parse(proof.secret);
                  return Array.isArray(parsed) && parsed[0] === 'P2PK';
                } catch {
                  return false;
                }
              });
              if (hasP2PK) {
                await manager.keyring.generateKeyPair();
              }
            } catch (e) {
              console.warn('Failed to regenerate P2PK key:', e);
            }
          }

          // Link scan history + capture location
          const history = await manager.history.getPaginatedHistory(0, 5);
          const realEntry = history.find(
            (h) => h.type === 'receive' && h.amount === entry.amount && h.mintUrl === entry.mintUrl
          );
          if (realEntry?.id) {
            // Update screen entry to the real persisted entry
            const setEntry = (rawCtx as Record<string, unknown>).setEntry as
              | ((e: Record<string, unknown>) => void)
              | undefined;
            if (setEntry) {
              setEntry(realEntry as unknown as Record<string, unknown>);
            }

            await captureAndStoreLocation(realEntry.id);
            const rawToken = (entry.metadata as Record<string, string> | undefined)?.rawToken;
            if (rawToken || tokenString) {
              useScanHistoryStore.getState().linkTransaction(rawToken || tokenString, realEntry.id);
            }
          }
        } catch (error) {
          const store = usePaymentStatusStore.getState();
          if (store.active?.id === entry.id && store.active?.state === 'processing') {
            store.setFailed(entry.id, error);
          } else {
            receiveFailedPopup({ text: error instanceof Error ? error.message : undefined });
          }
          throw error;
        }
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
        let operationId = entry.metadata?.operationId as string | undefined;
        const isPreview = !entry.quoteId;

        // Phase 1: Prepare (only when preview — no quote yet)
        // TODO: On prepare failure, navigate to mint selector to let user change mints
        if (isPreview) {
          const meltTarget = entry.metadata?.meltTarget;
          if (!meltTarget) throw new Error('Missing meltTarget in metadata');

          const bolt11 = isLightningInvoice(meltTarget)
            ? meltTarget
            : await requestInvoiceFromLnurl(meltTarget, entry.amount);

          const operation = await manager.quotes.prepareMeltBolt11(entry.mintUrl, bolt11);
          operationId = operation.id;

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
              metadata: { ...entry.metadata, phase: 'ready', operationId: operation.id },
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

        paymentStatusPopup({
          variant: 'melt',
          id: quoteId ?? operationId ?? entry.id,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit,
          operationId,
        });

        if (operationId) {
          await manager.quotes.executeMelt(operationId);
        } else if (quoteId) {
          await manager.quotes.executeMeltByQuote(entry.mintUrl, quoteId);
        }
      },

      cancel: async (rawCtx) => {
        const { entry, manager } = meltQuoteCtx(rawCtx);
        const operationId = entry.metadata?.operationId as string | undefined;

        if (!operationId && !entry.quoteId) {
          return;
        }

        try {
          if (operationId) {
            await manager.quotes.rollbackMelt(operationId, 'User cancelled');
          }
          paymentCancelledPopup();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
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

    // ── Payment Request ───────────────────────────────────────────────────
    paymentRequest: {
      confirm: async (rawCtx) => {
        const ctx = paymentRequestCtx(rawCtx);
        const { entry, manager } = ctx;
        const encodedRequest = entry.metadata?.paymentRequest;
        if (!encodedRequest) return;

        const info = defaultDetectors.getPaymentRequestInfo(encodedRequest);
        if (!info) return;

        const { mintUrl, amount } = entry;

        // Determine transport: nostr (type 'nostr'), http (type 'post'), or inband (no transport)
        const nostrTransport = info.transports?.find((t) => t.type === 'nostr');
        const httpTransport = info.transports?.find((t) => t.type === 'post');

        if (httpTransport) {
          // HTTP POST transport: use coco payment request API
          const parsed = await manager.wallet.processPaymentRequest(encodedRequest);
          const transaction = await manager.wallet.preparePaymentRequestTransaction(
            mintUrl,
            parsed,
            amount
          );
          await manager.wallet.handleHttpPaymentRequest(transaction);

          // Update entry state to reflect delivery
          ctx.setEntry?.({
            ...entry,
            metadata: { ...entry.metadata, phase: 'delivered', tokenCreated: 'true' },
          });

          paymentStatusPopup({
            variant: 'payment-request',
            id: entry.id,
            mintUrl,
            amount,
            unit: entry.unit,
          });
        } else if (nostrTransport) {
          // Nostr transport: create token + send via NIP-17 DM
          // Mark token creation in progress
          ctx.setEntry?.({
            ...entry,
            metadata: { ...entry.metadata, tokenCreated: 'true' },
          });

          const token = await manager.wallet.send(mintUrl, amount);

          // Build the PaymentRequestPayload: { id, mint, unit, proofs }
          const payload = {
            id: encodedRequest,
            mint: mintUrl,
            unit: entry.unit,
            proofs: token.proofs,
          };

          await ctx.sendDirectMessage(nostrTransport.target, JSON.stringify(payload));

          // Update entry state to reflect full delivery
          ctx.setEntry?.({
            ...entry,
            metadata: {
              ...entry.metadata,
              phase: 'delivered',
              tokenCreated: 'true',
              nostrSent: 'true',
            },
          });

          paymentStatusPopup({
            variant: 'payment-request',
            id: entry.id,
            mintUrl,
            amount,
            unit: entry.unit,
          });
        } else {
          // Inband / no transport: create token and navigate to SendTokenScreen
          const token = await manager.wallet.send(mintUrl, amount);
          const history = await manager.history.getPaginatedHistory();
          const sendEntry = history.find(
            (h) => h.type === 'send' && (h as SendHistoryEntry).mintUrl === mintUrl
          ) as SendHistoryEntry | undefined;

          if (sendEntry) {
            router.replace({
              pathname: '/(send-flow)/sendToken',
              params: { sendHistoryEntry: JSON.stringify(sendEntry) },
            });
          } else {
            // Fallback: update entry with token created state
            ctx.setEntry?.({
              ...entry,
              metadata: { ...entry.metadata, phase: 'delivered', tokenCreated: 'true' },
            });
          }
          void token;
        }
      },

      cancel: async (_rawCtx) => {
        router.back();
      },
    },
  };
}
