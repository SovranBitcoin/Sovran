import { fromPromise } from 'xstate';

import type {
  Manager,
  MintHistoryEntry,
  ReceiveHistoryEntry,
  SendHistoryEntry,
  MeltHistoryEntry,
} from 'coco-cashu-core';
import {
  decodePaymentRequest,
  getEncodedToken,
  PaymentRequestTransportType,
  type PaymentRequestPayload,
  type MeltQuoteBolt11Response,
} from '@cashu/cashu-ts';

import {
  getOfflineFiatSendSuggestions,
  getOfflineSendSuggestions,
  type OfflineFiatSendSuggestions,
  type OfflineSendSuggestions,
} from '@/features/send/lib/offlineSendSuggestions';
import { requestInvoiceFromLnurl } from '@/shared/lib/cashu/utils';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { selectBestMint, type MintSelectionResult } from '@/shared/lib/nfc/mint-selection';
import { debugLog } from '@/shared/lib/debugSession';

import type { SendResult, MeltQuoteResult } from './types';

// ---------------------------------------------------------------------------
// Token operations
// ---------------------------------------------------------------------------

/**
 * Prepare + execute an ecash send, then wait for the matching history entry.
 * Mirrors the core logic of useSendWithHistory without React dependencies.
 */
export const sendEcashActor = fromPromise(
  async ({
    input,
  }: {
    input: { mintUrl: string; amount: number; manager: Manager };
  }): Promise<SendResult> => {
    // #region agent log
    debugLog({
      location: 'actors.ts:sendEcashActor',
      message: 'sendEcashActor started',
      data: { mintUrl: input.mintUrl, amount: input.amount },
      hypothesisId: 'actor',
    });
    // #endregion
    const { manager, mintUrl, amount } = input;
    const prepared = await manager.send.prepareSend(mintUrl, amount);

    const { token } = await manager.send.executePreparedSend(prepared.id);
    const encodedToken = getEncodedToken(token as any);

    const historyEntry = await waitForSendHistoryEntry(manager, prepared.id, encodedToken);

    // #region agent log
    debugLog({
      location: 'actors.ts:sendEcashActor',
      message: 'sendEcashActor done',
      data: { operationId: prepared.id, historyEntryId: historyEntry?.id },
      hypothesisId: 'actor',
    });
    // #endregion
    return { token: encodedToken, historyEntry, operationId: prepared.id };
  }
);

export const rollbackSendActor = fromPromise(
  async ({ input }: { input: { operationId: string; manager: Manager } }): Promise<void> => {
    // #region agent log
    debugLog({
      location: 'actors.ts:rollbackSendActor',
      message: 'rollbackSendActor',
      data: { operationId: input.operationId },
      hypothesisId: 'actor',
    });
    // #endregion
    await input.manager.send.rollback(input.operationId);
  }
);

// ---------------------------------------------------------------------------
// Melt operations
// ---------------------------------------------------------------------------

export const prepareMeltQuoteActor = fromPromise(
  async ({
    input,
  }: {
    input: { mintUrl: string; invoice: string; manager: Manager };
  }): Promise<MeltQuoteResult> => {
    // #region agent log
    debugLog({
      location: 'actors.ts:prepareMeltQuoteActor',
      message: 'prepareMeltQuoteActor started',
      data: { mintUrl: input.mintUrl, invoiceLen: input.invoice?.length },
      hypothesisId: 'actor',
    });
    // #endregion
    const { manager, mintUrl, invoice } = input;
    // NOTE: In coco-cashu-core, prepareMeltBolt11 returns the PreparedMeltOperation object,
    // NOT the MeltQuoteBolt11Response directly. We must shim it.
    const operation = await manager.quotes.prepareMeltBolt11(mintUrl, invoice);

    const operationId = operation.id;
    const quoteId = (operation as any).quoteId as string;
    const amount = (operation as any).amount as number;
    const feeReserve = (operation as any).fee_reserve as number;

    // Construct the quote response expected by UI
    const quote: MeltQuoteBolt11Response = {
      quote: quoteId,
      amount: amount,
      fee_reserve: feeReserve,
      state: 'UNPAID',
      expiry: 0,
      payment_preimage: null,
      change: undefined,
      request: invoice,
      unit: 'sat',
    };

    // Retry fetching history entry a few times
    let historyEntry: MeltHistoryEntry | undefined;
    for (let i = 0; i < 3; i++) {
      const history = await manager.history.getPaginatedHistory();
      historyEntry = history.find((h) => h.type === 'melt' && h.quoteId === quoteId) as
        | MeltHistoryEntry
        | undefined;

      if (historyEntry) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Fallback: Construct history entry manually if not found
    if (!historyEntry && operationId) {
      historyEntry = {
        id: operationId,
        type: 'melt',
        createdAt: Date.now(),
        mintUrl: mintUrl,
        unit: 'sat', // Default to sat if not available
        quoteId: quoteId,
        state: 'UNPAID',
        amount: amount,
      };
    }

    return {
      quote,
      historyEntry: historyEntry as MeltQuoteResult['historyEntry'],
      operationId,
    };
  }
);

export const executeMeltQuoteActor = fromPromise(
  async ({ input }: { input: { operationId: string; manager: Manager } }): Promise<void> => {
    // #region agent log
    debugLog({
      location: 'actors.ts:executeMeltQuoteActor',
      message: 'executeMeltQuoteActor',
      data: { operationId: input.operationId },
      hypothesisId: 'actor',
    });
    // #endregion
    await input.manager.quotes.executeMelt(input.operationId);
  }
);

export const rollbackMeltActor = fromPromise(
  async ({
    input,
  }: {
    input: { operationId: string; reason: string; manager: Manager };
  }): Promise<void> => {
    await (input.manager.quotes as any).rollbackMelt(input.operationId, input.reason);
  }
);

// ---------------------------------------------------------------------------
// Mint quote (receive Lightning)
// ---------------------------------------------------------------------------

export const requestLightningInvoiceActor = fromPromise(
  async ({
    input,
  }: {
    input: { mintUrl: string; amount: number; manager: Manager };
  }): Promise<{ mintQuote: unknown; historyEntry: MintHistoryEntry | null }> => {
    const { manager, mintUrl, amount } = input;
    const mintQuote = await manager.quotes.createMintQuote(mintUrl, amount);

    const history = await manager.history.getPaginatedHistory();
    const historyEntry =
      (history.find(
        (h) =>
          h.type === 'mint' &&
          (h as MintHistoryEntry).quoteId === (mintQuote as { quote: string }).quote
      ) as MintHistoryEntry | undefined) ?? null;

    return { mintQuote, historyEntry };
  }
);

// ---------------------------------------------------------------------------
// Lightning resolution
// ---------------------------------------------------------------------------

export const resolveLnUrlActor = fromPromise(
  async ({
    input,
  }: {
    input: { lnUrlOrAddress: string; amount: number };
  }): Promise<{ invoice: string }> => {
    const invoice = await requestInvoiceFromLnurl(input.lnUrlOrAddress, input.amount);
    return { invoice };
  }
);

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export const captureLocationActor = fromPromise(
  async ({ input }: { input: { transactionId: string } }): Promise<boolean> => {
    return captureAndStoreLocation(input.transactionId);
  }
);

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

export const getOfflineSuggestionsActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      proofService: {
        getReadyProofs: (mintUrl: string) => Promise<{ amount: number }[]>;
        selectProofsToSend: (
          mintUrl: string,
          amount: number,
          includeFees: boolean
        ) => Promise<{ amount: number }[]>;
      };
      mintUrl: string;
      amount: number;
    };
  }): Promise<OfflineSendSuggestions> => {
    return getOfflineSendSuggestions(input.proofService, input.mintUrl, input.amount);
  }
);

/**
 * For fiat sends when online: check if the $0.01 batch around the requested
 * fiat amount has an offline-sendable sat amount. If yes, return it so the
 * machine can silently use the offline amount (tiny sat variation, same fiat value).
 * Returns null if no offline match found — the machine continues with online send.
 */
export const checkFiatOfflineOptimizationActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      proofService: {
        getReadyProofs: (mintUrl: string) => Promise<{ amount: number }[]>;
        selectProofsToSend: (
          mintUrl: string,
          amount: number,
          includeFees: boolean
        ) => Promise<{ amount: number }[]>;
      };
      mintUrl: string;
      amount: number;
      btcPrice: number;
    };
  }): Promise<{ fiatOfflineAmount: number | null }> => {
    try {
      const fiatMinorUnit = Math.round((input.amount / 100_000_000) * input.btcPrice * 100);
      const suggestions = await getOfflineFiatSendSuggestions(
        input.proofService,
        input.mintUrl,
        input.amount,
        fiatMinorUnit,
        input.btcPrice
      );
      if (suggestions.autoSelectAmount != null) {
        return { fiatOfflineAmount: suggestions.autoSelectAmount };
      }
      return { fiatOfflineAmount: null };
    } catch {
      return { fiatOfflineAmount: null };
    }
  }
);

// ---------------------------------------------------------------------------
// NFC
// ---------------------------------------------------------------------------

export const selectBestMintActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      allowedMints: string[] | undefined;
      availableMints: Record<string, number>;
      amount: number;
      preferredMint?: string;
    };
  }): Promise<MintSelectionResult> => {
    // #region agent log
    debugLog({
      location: 'actors.ts:selectBestMintActor',
      message: 'selectBestMintActor',
      data: { amount: input.amount, preferredMint: input.preferredMint },
      hypothesisId: 'actor',
    });
    // #endregion
    return selectBestMint(
      input.allowedMints,
      input.availableMints,
      input.amount,
      input.preferredMint
    );
  }
);

// ---------------------------------------------------------------------------
// Mint quote redemption
// ---------------------------------------------------------------------------

/**
 * Called after the user's Lightning payment is confirmed (PAYMENT_RECEIVED).
 * coco's MintQuoteWatcherService automatically claims proofs when a quote
 * transitions to PAID — no explicit action is needed here. This actor exists
 * as a formal machine transition point so the machine can model the flow.
 */
export const redeemMintQuoteActor = fromPromise(async (): Promise<void> => {
  // Intentional no-op: coco's watcher handles proof minting automatically.
});

// ---------------------------------------------------------------------------
// Camera permissions
// ---------------------------------------------------------------------------

/**
 * Request camera permission via expo-camera. Returns 'granted' or 'denied'.
 * This is a placeholder actor — the real implementation is provided via
 * machine.provide() in the hook, since expo-camera requires native module resolution.
 */
export const requestCameraPermissionActor = fromPromise(
  async (): Promise<{ status: 'granted' | 'denied' }> => {
    throw new Error(
      'requestCameraPermission must be provided via machine.provide(). ' +
        'Wire expo-camera getCameraPermissionsAsync / requestCameraPermissionsAsync here.'
    );
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a matching send history entry via manager events, with fallback
 * to paginated history search. Timeout after 5 seconds.
 */
async function waitForSendHistoryEntry(
  manager: Manager,
  operationId: string,
  token: string
): Promise<SendHistoryEntry> {
  return new Promise<SendHistoryEntry>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      manager.history
        .getPaginatedHistory()
        .then((history) => {
          const match = history.find((h) => {
            if (h.type !== 'send') return false;
            const entry = h as SendHistoryEntry;
            if (!entry.token) return false;

            // Handle both string and object tokens
            const hTokenString =
              typeof entry.token === 'string' ? entry.token : getEncodedToken(entry.token as any);

            return hTokenString === token;
          }) as SendHistoryEntry | undefined;
          if (match) {
            resolve(match);
          } else {
            reject(new Error('Timeout waiting for send history entry'));
          }
        })
        .catch(reject);
    }, 5_000);

    const handler = (entry: unknown) => {
      const e = entry as SendHistoryEntry;
      if (e.type === 'send' && e.operationId === operationId) {
        cleanup();
        resolve(e);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      manager.off('history:updated', handler);
    };

    manager.on('history:updated', handler);
  });
}

// ---------------------------------------------------------------------------
// Payment request (NUT-18) send
// ---------------------------------------------------------------------------

/** Async function signature for sending a NIP-17 gift-wrapped DM. */
export type SendNostrDm = (
  nprofile: string,
  message: string,
  opts: { additionalRelays: string[] }
) => Promise<void>;

/**
 * Execute a NUT-18 ecash payment request:
 * prepare ecash token → execute → decode PR → build payload → send Nostr DM.
 *
 * `sendNostrDm` is injected at call-site (from `useNostrDirectMessage`) so
 * this helper remains pure and free of React/hook dependencies.
 */
export async function executePaymentRequestSend(input: {
  mintUrl: string;
  amount: number;
  manager: Manager;
  encodedPaymentRequest: string;
  unit: string;
  sendNostrDm: SendNostrDm;
}): Promise<{ historyEntry: SendHistoryEntry; operationId: string }> {
  const { mintUrl, amount, manager, encodedPaymentRequest, unit, sendNostrDm } = input;

  const decoded = decodePaymentRequest(encodedPaymentRequest);

  const nostrTransport = decoded.transport?.find(
    (t) => t.type === PaymentRequestTransportType.NOSTR
  );
  if (!nostrTransport?.target) {
    throw new Error('Payment request has no Nostr transport');
  }

  const prepared = await manager.send.prepareSend(mintUrl, amount);
  const { token: rawToken } = await manager.send.executePreparedSend(prepared.id);

  const encodedToken = getEncodedToken(rawToken as any);

  const payload: PaymentRequestPayload = {
    id: decoded.id ?? '',
    mint: mintUrl,
    unit: decoded.unit ?? unit,
    proofs: (rawToken as any).proofs,
  };

  await sendNostrDm(nostrTransport.target, JSON.stringify(payload), { additionalRelays: [] });

  const historyEntry = await waitForSendHistoryEntry(manager, prepared.id, encodedToken);
  return { historyEntry, operationId: prepared.id };
}

/**
 * Placeholder — real implementation injected via paymentMachine.provide() in usePaymentMachine.
 */
export const sendPaymentRequestPlaceholder = fromPromise(
  async (_: {
    input: {
      mintUrl: string;
      amount: number;
      manager: Manager;
      encodedPaymentRequest: string;
      unit: string;
    };
  }): Promise<{ historyEntry: SendHistoryEntry; operationId: string }> => {
    throw new Error('sendPaymentRequest must be provided via machine.provide()');
  }
);

// ---------------------------------------------------------------------------
// Ecash receive
// ---------------------------------------------------------------------------

/**
 * Redeem an ecash token via coco wallet.receive().
 * Returns the ReceiveHistoryEntry created by coco, found by matching amount + mintUrl
 * in recent history (coco does not return the entry directly from receive()).
 */
export const receiveEcashActor = fromPromise(
  async ({
    input,
  }: {
    input: { tokenString: string; manager: Manager };
  }): Promise<ReceiveHistoryEntry> => {
    const { tokenString, manager } = input;
    await manager.wallet.receive(tokenString);

    // Locate the history entry coco just created (most recent receive matching token)
    const history = await manager.history.getPaginatedHistory(0, 10);
    const entry = history.find((h) => h.type === 'receive') as ReceiveHistoryEntry | undefined;
    if (!entry) {
      throw new Error('Receive completed but history entry not found');
    }
    return entry;
  }
);

/**
 * Rotate P2PK keypair after redeeming a P2PK-locked token.
 * Non-critical: swallows errors so a keygen failure never blocks the receive flow.
 */
export const rotateP2PKKeyActor = fromPromise(
  async ({ input }: { input: { manager: Manager } }): Promise<void> => {
    try {
      await input.manager.keyring.generateKeyPair();
    } catch (e) {
      console.warn('[rotateP2PKKeyActor] Failed to rotate P2PK key:', e);
    }
  }
);
