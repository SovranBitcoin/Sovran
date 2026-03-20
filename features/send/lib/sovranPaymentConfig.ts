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

import { Share } from 'react-native';
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
  nfcSendFailedPopup,
  noAmountPopup,
  noMintSelectedPopup,
  noClipboardAddressPopup,
  noQrCodeFoundPopup,
  noValidMintPopup,
  operationInvalidStatePopup,
  operationNotFoundPopup,
  paymentCancelledPopup,
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
  };
}

// =============================================================================
// createSovranScanSources
// =============================================================================

export function createSovranScanSources(): ScanSources {
  return {
    clipboard: async () => {
      const rawText = (await Clipboard.getStringAsync()).trim();
      const decodedText = isEncoded(rawText) ? decode(rawText) : rawText;
      if (!decodedText) return { empty: true };
      useScanHistoryStore.getState().addScan(rawText, decodedText, 'unknown', 'paste');
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
      router.navigate({
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
      const params: Record<string, string> = {
        unit,
        mintItems: JSON.stringify(mintListItems ?? []),
      };
      if (destination) params.destination = destination;
      if (scope) params.mintScope = scope;

      const pathname =
        destination === 'mintQuote' || scope === 'npc'
          ? '/(receive-flow)/mintSelect'
          : '/(send-flow)/mintSelect';
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

          const realEntry = await findReceiveHistoryEntryByToken(
            manager,
            tokenString,
            entry.mintUrl,
            entry.amount
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
        let screenEntry: EntryRecord = entry as unknown as EntryRecord;
        let paymentId = entry.quoteId || operationId || entry.id;

        const setScreenEntry = (patch: EntryRecord) => {
          screenEntry = mergeScreenEntry(screenEntry, patch);
          const setEntry = (rawCtx as Record<string, unknown>).setEntry as
            | ((e: Record<string, unknown>) => void)
            | undefined;
          setEntry?.(screenEntry);
        };

        if (isPreview) {
          const meltTarget = entry.metadata?.meltTarget;
          if (!meltTarget) throw new Error('Missing meltTarget in metadata');

          const bolt11 = isLightningInvoice(meltTarget)
            ? meltTarget
            : await requestInvoiceFromLnurl(meltTarget, entry.amount);

          const operation = await manager.quotes.prepareMeltBolt11(entry.mintUrl, bolt11);
          operationId = operation.id;
          paymentId = operation.quoteId;
          setScreenEntry({
            id: operation.id,
            type: 'melt',
            createdAt: operation.createdAt,
            mintUrl: operation.mintUrl,
            unit: entry.unit,
            quoteId: operation.quoteId,
            state: 'UNPAID',
            amount: operation.amount,
            metadata: { phase: 'ready', operationId: operation.id },
          });
        }

        const quoteId = !isPreview ? entry.quoteId : paymentId;

        const store = usePaymentStatusStore.getState();
        if (paymentId && store.active?.id === paymentId && store.active?.state === 'failed') {
          store.setActive(null);
        }
        store.setActive({
          variant: 'melt',
          id: paymentId,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit,
          state: 'processing',
        });

        paymentStatusPopup({
          variant: 'melt',
          id: paymentId,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit,
          operationId,
        });

        const result = operationId
          ? await manager.quotes.executeMelt(operationId)
          : quoteId
            ? await manager.quotes.executeMeltByQuote(entry.mintUrl, quoteId)
            : null;

        if (result) {
          setScreenEntry({
            id: result.id,
            type: 'melt',
            createdAt: result.createdAt,
            mintUrl: result.mintUrl,
            unit: entry.unit,
            quoteId: result.quoteId,
            state: mapMeltOperationState(result.state),
            amount: result.amount,
            metadata: { operationId: result.id },
          });
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
        let screenEntry: EntryRecord = entry as unknown as EntryRecord;
        const setScreenEntry = (patch: EntryRecord) => {
          screenEntry = mergeScreenEntry(screenEntry, patch);
          ctx.setEntry?.(screenEntry);
        };
        const restorePreviewEntry = () => {
          screenEntry = entry as unknown as EntryRecord;
          ctx.setEntry?.(screenEntry);
        };

        try {
          const nostrTransport = info.transports?.find((t) => t.type === 'nostr');
          const httpTransport = info.transports?.find((t) => t.type === 'post');
          const parsed =
            nostrTransport && !httpTransport
              ? buildInbandParsedPaymentRequest(encodedRequest, info, mintUrl)
              : await manager.wallet.processPaymentRequest(encodedRequest);

          if (httpTransport) {
            const transaction = await manager.wallet.preparePaymentRequestTransaction(
              mintUrl,
              parsed,
              amount
            );
            const operationId = transaction.sendOperation.id;
            const preparedEntry =
              (await findSendHistoryEntryByOperationId(manager, operationId)) ??
              ({
                id: operationId,
                type: 'send',
                createdAt: transaction.sendOperation.createdAt,
                mintUrl,
                amount,
                unit: entry.unit,
                operationId,
                state: 'prepared',
              } as SendHistoryEntry);

            setScreenEntry({
              ...(preparedEntry as unknown as EntryRecord),
              metadata: {
                paymentRequest: encodedRequest,
                phase: 'created',
                operationId,
              },
            });

            try {
              await manager.wallet.handleHttpPaymentRequest(transaction);
            } catch (error) {
              await manager.send.rollback(operationId);
              restorePreviewEntry();
              throw error;
            }

            setScreenEntry({
              state: 'pending',
              metadata: { phase: 'delivered', tokenCreated: 'true' },
            });

            paymentStatusPopup({
              variant: 'payment-request',
              id: operationId,
              mintUrl,
              amount,
              unit: entry.unit,
            });
            return;
          }

          if (nostrTransport) {
            const transaction = await manager.wallet.preparePaymentRequestTransaction(
              mintUrl,
              parsed,
              amount
            );
            const operationId = transaction.sendOperation.id;
            const preparedEntry =
              (await findSendHistoryEntryByOperationId(manager, operationId)) ??
              ({
                id: operationId,
                type: 'send',
                createdAt: transaction.sendOperation.createdAt,
                mintUrl,
                amount,
                unit: entry.unit,
                operationId,
                state: 'prepared',
              } as SendHistoryEntry);

            setScreenEntry({
              ...(preparedEntry as unknown as EntryRecord),
              metadata: {
                paymentRequest: encodedRequest,
                phase: 'created',
                operationId,
              },
            });

            let tokenCreated = false;
            try {
              await manager.wallet.handleInbandPaymentRequest(transaction, async (token) => {
                tokenCreated = true;
                setScreenEntry({
                  state: 'pending',
                  metadata: {
                    tokenCreated: 'true',
                  },
                });

                const payload = {
                  id: encodedRequest,
                  mint: mintUrl,
                  unit: entry.unit,
                  proofs: token.proofs,
                };

                await ctx.sendDirectMessage(nostrTransport.target, JSON.stringify(payload));

                setScreenEntry({
                  metadata: {
                    phase: 'delivered',
                    tokenCreated: 'true',
                    nostrSent: 'true',
                  },
                });
              });
            } catch (error) {
              if (tokenCreated) {
                await manager.send.rollback(operationId);
              }
              restorePreviewEntry();
              throw error;
            }

            paymentStatusPopup({
              variant: 'payment-request',
              id: operationId,
              mintUrl,
              amount,
              unit: entry.unit,
            });
            return;
          }

          const transaction = await manager.wallet.preparePaymentRequestTransaction(
            mintUrl,
            parsed,
            amount
          );
          await manager.wallet.handleInbandPaymentRequest(transaction, async () => {});
          const sendEntry = await findSendHistoryEntryByOperationId(
            manager,
            transaction.sendOperation.id
          );

          if (sendEntry) {
            router.replace({
              pathname: '/(send-flow)/sendToken',
              params: { sendHistoryEntry: JSON.stringify(sendEntry) },
            });
          } else {
            setScreenEntry({
              id: transaction.sendOperation.id,
              type: 'send',
              createdAt: transaction.sendOperation.createdAt,
              mintUrl,
              amount,
              unit: entry.unit,
              operationId: transaction.sendOperation.id,
              state: 'pending',
              metadata: {
                paymentRequest: encodedRequest,
                phase: 'delivered',
                tokenCreated: 'true',
              },
            });
          }
        } catch (error) {
          sendPaymentFailedPopup({ text: error instanceof Error ? error.message : undefined });
        }
      },

      cancel: async (_rawCtx) => {
        router.back();
      },
    },

    receive: {
      copy: async (rawCtx) => {
        const entry = rawCtx.entry as {
          npcAddress?: string;
          p2pkKey?: string;
        };
        const source = ((rawCtx as Record<string, unknown>).source ?? 'npc') as 'npc' | 'p2pk';
        const text = source === 'p2pk' ? entry.p2pkKey : entry.npcAddress;
        if (!text) return;
        await Clipboard.setStringAsync(text);
        copyPopup(source === 'npc' ? 'lightningAddress' : 'p2pk');
      },

      paste: async (rawCtx) => {
        const machine = (rawCtx as { paymentMachine?: PaymentMachine }).paymentMachine;
        await machine?.scan?.();
      },

      fixedAmount: async (rawCtx) => {
        const machine = (rawCtx as { paymentMachine?: PaymentMachine }).paymentMachine;
        await machine?.startReceiveLightning?.();
      },

      scanQr: async (rawCtx) => {
        const requestCamera = (rawCtx as { requestCameraPermission?: () => Promise<boolean> })
          .requestCameraPermission;
        const granted = requestCamera ? await requestCamera() : false;
        if (!granted) return;
        const unit = (rawCtx.entry as { unit?: string }).unit ?? 'sat';
        router.navigate({
          pathname: '/(receive-flow)/camera',
          params: { unit },
        });
      },

      changeNpcMint: async (rawCtx) => {
        const machine = (rawCtx as { paymentMachine?: PaymentMachine }).paymentMachine;
        await machine?.requestMintSelector?.({ scope: 'npc' });
      },
    },

    amountEntry: {
      next: async (rawCtx) => {
        const machine = (rawCtx as { paymentMachine?: PaymentMachine }).paymentMachine;
        if (!machine) return;
        const entry = rawCtx.entry as Record<string, unknown>;
        const effectiveSat = entry.effectiveSatAmount;
        const mintUrl = typeof entry.selectedMintUrl === 'string' ? entry.selectedMintUrl : '';
        if (typeof effectiveSat !== 'number' || effectiveSat <= 0) return;
        const destination = entry.destination as Destination | undefined;
        if (!destination) return;
        void machine.enterAmount(effectiveSat, mintUrl, { destination });
      },
      paste: async (rawCtx) => {
        const entry = rawCtx.entry as { destination?: string };
        if (entry.destination !== 'sendEcash') return;
        const machine = (rawCtx as { paymentMachine?: PaymentMachine }).paymentMachine;
        await machine?.scan?.();
      },
      scanQr: async (rawCtx) => {
        const entry = rawCtx.entry as { destination?: string; unit?: string };
        if (entry.destination !== 'sendEcash') return;
        const unit = entry.unit ?? 'sat';
        router.navigate({ pathname: '/camera', params: { unit } });
      },
    },
  };
}
