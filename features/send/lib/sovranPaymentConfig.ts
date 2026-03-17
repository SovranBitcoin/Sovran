/**
 * @fileoverview Sovran payment flow config — single source for coco-payment-ux glue
 *
 * All four factory functions that inject Sovran-specific behavior into coco-payment-ux:
 * - createSovranNotifications: error/notification popups
 * - createSovranOperations: executeSend, executeMintQuote, buildMintListItems
 * - createSovranHandlers: step handlers (navigation, popups, dismiss)
 * - createSovranScreenActionHandlers: post-terminal actions (copy, share, NFC, redeem, pay)
 *
 * Consumed by PaymentFlowProvider (notifications, operations, handlers) and
 * useScreenActions (screenActionHandlers).
 */

import type { MutableRefObject } from 'react';
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
import {
  defaultDetectors,
  buildMintAvailability,
  type MachineOperations,
  type NotificationHandlerMap,
  type PaymentMachine,
  type ScreenActionContext,
  type ScreenActionHandlerMap,
  type StepHandlerMap,
  type WalletContext,
} from 'coco-payment-ux';

import { buildMintListItems } from '@/shared/lib/buildMintListItems';
import {
  buildReceiveHistoryEntry,
  isLightningInvoice,
  requestInvoiceFromLnurl,
} from '@/shared/lib/cashu/utils';
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
  nfcSendFailedPopup,
  noAmountPopup,
  noValidMintPopup,
  operationInvalidStatePopup,
  operationNotFoundPopup,
  paymentCancelledPopup,
  paymentOptionsPopup,
  paymentStatusPopup,
  proofSelectorPopup,
  receiveFailedPopup,
  tokenPendingNotRedeemedPopup,
  tokenRedeemedByRecipientPopup,
  transactionAlreadyCancelledPopup,
  transactionCancelledPopup,
  unsupportedInputPopup,
  unsupportedTokenUnitPopup,
} from '@/shared/lib/popup';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
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
  };
}

// =============================================================================
// createSovranOperations
// =============================================================================

interface CreateSovranOperationsConfig {
  managerRef: MutableRefObject<Manager>;
  walletContextRef: MutableRefObject<WalletContext | null>;
}

export function createSovranOperations({
  managerRef,
  walletContextRef,
}: CreateSovranOperationsConfig): MachineOperations {
  return {
    executeSend: async (mintUrl, amount) => {
      const mgr = managerRef.current;
      await mgr.wallet.send(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory();
      const entry = history.find(
        (h) => h.type === 'send' && (h as SendHistoryEntry).mintUrl === mintUrl
      ) as SendHistoryEntry | undefined;
      if (!entry) throw new Error('Send history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    executeMintQuote: async (mintUrl, amount, _unit) => {
      const mgr = managerRef.current;
      const mintQuote = await mgr.quotes.createMintQuote(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory();
      const entry = history.find(
        (h) => h.type === 'mint' && (h as MintHistoryEntry).quoteId === mintQuote.quote
      ) as MintHistoryEntry | undefined;
      if (!entry) throw new Error('Mint quote history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    buildMintListItems: async (stepData) => {
      const mgr = managerRef.current;
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
              proofAmounts: walletContextRef.current?.proofAmounts ?? {},
            }
          : undefined;
      return buildMintListItems(allTrustedMints, availability, offlineCheck);
    },
  };
}

// =============================================================================
// createSovranHandlers
// =============================================================================

interface CreateSovranHandlersConfig {
  machine: PaymentMachine;
  onOptionDismiss?: () => void;
}

export function createSovranHandlers({
  machine,
  onOptionDismiss,
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
      router.navigate({
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
      router.replace({
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

    openMint: ({ url }) => {
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: { mintUrl: url, fromScan: '1' },
      });
    },

    openProfile: ({ npub }) => {
      router.navigate({
        pathname: '/(user-flow)/profile',
        params: { npub },
      });
    },

    enterAmount: ({ unit, preselectedMintUrl, constraints }) => {
      const params: Record<string, string> = { unit };
      if (constraints.destination) params.destination = constraints.destination;
      if (preselectedMintUrl) params.selectedMintUrl = preselectedMintUrl;
      if (constraints.paymentRequest) params.paymentRequest = constraints.paymentRequest;
      if (constraints.meltTarget) params.meltTarget = constraints.meltTarget;

      const pathname =
        constraints.destination === 'mintQuote' ? '/(receive-flow)/amount' : '/(send-flow)/amount';
      router.navigate({ pathname: pathname as any, params });
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
    }) => {
      const params: Record<string, string> = {
        unit,
        mintItems: JSON.stringify(mintListItems ?? []),
      };
      if (destination) params.destination = destination;

      const pathname =
        destination === 'mintQuote' ? '/(receive-flow)/mintSelect' : '/(send-flow)/mintSelect';
      router.navigate({ pathname: pathname as any, params });
    },

    chooseOption: (stepData) => {
      paymentOptionsPopup({ ...stepData, machine, onDismiss: onOptionDismiss });
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

export function createSovranScreenActionHandlers(): ScreenActionHandlerMap {
  return {
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

    receiveToken: {
      redeem: async (rawCtx) => {
        const { entry, manager } = receiveTokenCtx(rawCtx);
        if (!entry.token) return;

        const tokenString = manager.wallet.encodeToken(entry.token);

        const decoded = getDecodedToken(tokenString);
        if (decoded.unit !== 'sat') {
          unsupportedTokenUnitPopup({ unit: decoded.unit ?? 'unknown' });
          return;
        }

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

          const history = await manager.history.getPaginatedHistory(0, 5);
          const realEntry = history.find(
            (h) => h.type === 'receive' && h.amount === entry.amount && h.mintUrl === entry.mintUrl
          );
          if (realEntry?.id) {
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

    meltQuote: {
      pay: async (rawCtx) => {
        const { entry, manager } = meltQuoteCtx(rawCtx);
        let operationId = entry.metadata?.operationId as string | undefined;
        const isPreview = !entry.quoteId;

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
          // todo: I think here we should be calling some internal function of the machine/coco-payment-ux like ctx.statusUpdate({... type: 'CANCELLED', ... }) or something along these lines and then we have in our createSovranNotifications we handle it. Look at how createSovranNoticiations are currently called.
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

    paymentRequest: {
      confirm: async (rawCtx) => {
        const ctx = paymentRequestCtx(rawCtx);
        const { entry, manager } = ctx;
        const encodedRequest = entry.metadata?.paymentRequest;
        if (!encodedRequest) return;

        const info = defaultDetectors.getPaymentRequestInfo(encodedRequest);
        if (!info) return;

        const { mintUrl, amount } = entry;

        const nostrTransport = info.transports?.find((t) => t.type === 'nostr');
        const httpTransport = info.transports?.find((t) => t.type === 'post');

        if (httpTransport) {
          const parsed = await manager.wallet.processPaymentRequest(encodedRequest);
          const transaction = await manager.wallet.preparePaymentRequestTransaction(
            mintUrl,
            parsed,
            amount
          );
          await manager.wallet.handleHttpPaymentRequest(transaction);

          ctx.setEntry?.({
            ...entry,
            metadata: { ...entry.metadata, phase: 'delivered', tokenCreated: 'true' },
          });

          // todo: I think here we should be calling some internal function of the machine/coco-payment-ux like ctx.statusUpdate({... type: 'DELIVERED', ... }) or something along these lines and then we have in our createSovranNotifications we handle it. Look at how createSovranNoticiations are currently called.
          paymentStatusPopup({
            variant: 'payment-request',
            id: entry.id,
            mintUrl,
            amount,
            unit: entry.unit,
          });
        } else if (nostrTransport) {
          ctx.setEntry?.({
            ...entry,
            metadata: { ...entry.metadata, tokenCreated: 'true' },
          });

          const token = await manager.wallet.send(mintUrl, amount);

          const payload = {
            id: encodedRequest,
            mint: mintUrl,
            unit: entry.unit,
            proofs: token.proofs,
          };

          await ctx.sendDirectMessage(nostrTransport.target, JSON.stringify(payload));

          ctx.setEntry?.({
            ...entry,
            metadata: {
              ...entry.metadata,
              phase: 'delivered',
              tokenCreated: 'true',
              nostrSent: 'true',
            },
          });

          // todo: I think here we should be calling some internal function of the machine/coco-payment-ux like ctx.statusUpdate({... type: 'DELIVERED', ... }) or something along these lines and then we have in our createSovranNotifications we handle it. Look at how createSovranNoticiations are currently called.
          paymentStatusPopup({
            variant: 'payment-request',
            id: entry.id,
            mintUrl,
            amount,
            unit: entry.unit,
          });
        } else {
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
