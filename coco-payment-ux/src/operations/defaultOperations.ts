// ---------------------------------------------------------------------------
// Default Operations — backed by coco-cashu-core Manager
//
// Operations that only need the Manager API. Wallet apps get these out of
// the box and only need to provide what's app-specific: handlers
// (navigation), notifications (UI), and platform primitives.
//
// App-side operations (NOT included):
//   executeMelt        — needs requestInvoiceFromLnurl (lightning address resolution)
//   executePaymentRequest — needs Nostr transport / complex HTTP routing
//   buildMintReviewInfo   — needs KYM/audit API calls (external APIs)
//   linkTransaction       — needs app-specific scan history store
// ---------------------------------------------------------------------------

import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { Manager } from 'coco-cashu-core';
import type { MachineOperations, StepDataMap } from '../machine/types';
import type { MintListItem } from '../types';

// ---------------------------------------------------------------------------
// History lookup helper
// ---------------------------------------------------------------------------

async function findSendHistoryEntryByOperationId(
  mgr: Manager,
  operationId: string
): Promise<string | null> {
  const history = await mgr.history.getPaginatedHistory(0, 50);
  const entry = history.find(
    (h: any) =>
      h.type === 'send' &&
      (h.operationId === operationId || h.metadata?.operationId === operationId)
  );
  return entry ? JSON.stringify(entry) : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DefaultOperationsConfig {
  getManager: () => Manager | null;
  getProofAmounts?: () => Record<string, number[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDefaultOperations(config: DefaultOperationsConfig): Partial<MachineOperations> {
  const { getManager, getProofAmounts } = config;

  function requireManager(): Manager {
    const mgr = getManager();
    if (!mgr) throw new Error('Wallet manager is not available');
    return mgr;
  }

  return {
    executeSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      await mgr.wallet.send(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory(0, 25);
      const entry = history.find(
        (h: any) => h.type === 'send' && h.mintUrl === mintUrl
      );
      if (!entry) throw new Error('Send history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    executeMintQuote: async (mintUrl, amount, _unit) => {
      const mgr = requireManager();
      const mintQuote = await mgr.quotes.createMintQuote(mintUrl, amount);
      const history = await mgr.history.getPaginatedHistory(0, 25);
      const entry = history.find(
        (h: any) => h.type === 'mint' && h.quoteId === mintQuote.quote
      );
      if (!entry) throw new Error('Mint quote history entry not found after creation');
      return { historyEntry: JSON.stringify(entry) };
    },

    buildMintListItems: async (data: StepDataMap['selectMint']): Promise<MintListItem[]> => {
      const mgr = requireManager();
      const [allTrustedMints, balances] = await Promise.all([
        mgr.mint.getAllTrustedMints(),
        mgr.wallet.getBalances(),
      ]);

      const supportedSet = data.supportedMintUrls
        ? new Set(data.supportedMintUrls)
        : null;

      const proofAmounts = getProofAmounts?.() ?? {};

      return allTrustedMints.map((mint: any): MintListItem => {
        const mintUrl = mint.mintUrl;
        const balance = balances[mintUrl] ?? 0;
        const isInCandidate = data.candidates.some((c) => c.mintUrl === mintUrl);

        let status: 'available' | 'disabled' = 'available';
        let reason: MintListItem['reason'] = null;

        if (supportedSet && !supportedSet.has(mintUrl)) {
          status = 'disabled';
          reason = { code: 'NOT_IN_PAYMENT_REQUEST', message: 'Not accepted by payment request' };
        } else if (data.amount && balance < data.amount) {
          status = 'disabled';
          reason = { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' };
        } else if (!isInCandidate && balance <= 0) {
          status = 'disabled';
          reason = { code: 'NO_BALANCE', message: 'No balance' };
        }

        return {
          mintUrl,
          displayName: mint.displayName ?? mint.mintUrl,
          iconUrl: mint.iconUrl,
          balance,
          unit: data.unit,
          status,
          reason,
          isPreferred: false,
        };
      });
    },

    trustMint: async (mintUrl) => {
      const mgr = requireManager();
      await mgr.mint.addMint(mintUrl, { trusted: true });
    },

    executeNfcSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      const prepared = await mgr.send.prepareSend(mintUrl, amount);
      const { operation, token } = await mgr.send.executePreparedSend(prepared.id);
      const historyEntry = await findSendHistoryEntryByOperationId(mgr, operation.id);
      if (!historyEntry) throw new Error('Send history entry not found after creation');
      return {
        token: getEncodedTokenV4(token),
        historyEntry,
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
      } catch {
        // Best-effort rollback — swallow errors
      }
    },

    // ── Screen action operations ────────────────────────────────────

    checkSendStatus: async (operationId) => {
      const mgr = requireManager();
      const operation = await mgr.send.getOperation(operationId);
      if (!operation) {
        return { state: 'not_found' };
      }
      if (operation.state === 'pending') {
        await mgr.send.checkPendingOperation(operationId);
        const updated = await mgr.send.getOperation(operationId);
        return { state: updated?.state ?? operation.state };
      }
      return { state: operation.state };
    },

    executeReceive: async (tokenString, mintUrl, _amount) => {
      const mgr = requireManager();
      await mgr.wallet.receive(tokenString);
      const historyEntry = await findReceiveHistoryEntry(mgr, tokenString, mintUrl);
      if (!historyEntry) throw new Error('Receive history entry not found after redemption');
      return { historyEntry };
    },

    isMintTrusted: async (mintUrl) => {
      const mgr = requireManager();
      return mgr.mint.isTrustedMint(mintUrl);
    },
  };
}

// ---------------------------------------------------------------------------
// Receive history lookup helper
// ---------------------------------------------------------------------------

async function findReceiveHistoryEntry(
  mgr: Manager,
  tokenString: string,
  mintUrl: string
): Promise<string | null> {
  const history = await mgr.history.getPaginatedHistory(0, 50);
  const entry = history.find(
    (h: any) =>
      h.type === 'receive' &&
      h.mintUrl === mintUrl &&
      (h.metadata?.rawToken === tokenString ||
        h.token === tokenString)
  );
  return entry ? JSON.stringify(entry) : null;
}
