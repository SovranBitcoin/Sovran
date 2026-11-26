// ---------------------------------------------------------------------------
// Receive and mint-quote operations that follow Coco's own operation records.
//
// The wallet's only receive and mint-quote operations: `defaultOperations.ts`
// has none. They wait for the row Coco saved and use its id, so nothing
// downstream is keyed to an id that history never shows, and a receive that
// cannot reach the mint is reported as pending, not failed.
//
// What only the app knows is passed in: how to check a token offline, how to
// prepare a mint quote, the words for a pending receive, and a local id.
// ---------------------------------------------------------------------------

import { getTokenMetadata } from '@cashu/cashu-ts';
import { operationHistoryId, projectReceiveOperation } from '@cashu/coco-core';
import type {
  FinalizedReceiveOperation,
  HistoryEntry,
  LegacyMintHistoryEntry,
  Manager,
  MintHistoryEntry,
} from '@cashu/coco-core';

import { amountToNumber, type AmountValue } from '../amount';
import { serializeHistoryEntry } from '../history/normalize';
import { logger, mintUrlFields } from '../logger';
import type { MachineOperations } from '../machine/types';
import { proofsHaveP2PK } from '../p2pk';
import { withTimeout } from '../safeFetch';
import { classifyMeshRedeemError } from '../transport/redeemOrchestrator';

type PreparedReceive = Awaited<ReturnType<Manager['ops']['receive']['prepare']>>;

interface ReceiveDeps {
  getManager: () => Manager | null;
  getOffline?: () => boolean;
  /**
   * Throws unless the prepared token can be trusted without the mint (a valid
   * DLEQ on every proof). Called before anything is redeemed.
   */
  verifyOfflineReceive: (manager: Manager, prepared: PreparedReceive) => Promise<void>;
  /** What the person is told while a receive waits for the mint. */
  pendingMessage: string;
}

/** What a prepared mint quote has to carry for its history entry. */
interface PreparedMintQuote {
  id: string;
  quoteId: string;
  createdAt: number;
  mintUrl: string;
  unit: string;
  amount: AmountValue;
  request: string;
}

interface MintQuoteDeps {
  getManager: () => Manager | null;
  prepareMintQuote: (
    manager: Manager,
    method: 'bolt11' | 'onchain',
    mintUrl: string,
    amount: number,
    unit: string | undefined
  ) => Promise<PreparedMintQuote>;
}

// ---------------------------------------------------------------------------
// executeReceive
// ---------------------------------------------------------------------------

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

async function waitForReceiveHistoryEntry(
  manager: Manager,
  operationId: string,
  mintUrl: string,
) {
  const MAX_ATTEMPTS = 50; // ~10s of polling at 200ms intervals
  const DELAY_MS = 200;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const entry = await manager.history.getHistoryEntryById(
        operationHistoryId('receive', operationId)
      );
      if (entry?.type === 'receive' && entry.operationId === operationId) {
        logger.info('payment.execute_receive.found', {
          ...mintUrlFields(mintUrl),
          realId: entry.id,
          operationId,
          attempts: attempt + 1,
        });
        return entry;
      }
    } catch (e) {
      logger.warn('payment.execute_receive.poll_failed', {
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

async function finalizedReceiveResult(
  manager: Manager,
  operation: FinalizedReceiveOperation,
  hadP2PKProofs: boolean
) {
  const entry = await waitForReceiveHistoryEntry(manager, operation.id, operation.mintUrl);
  if (!entry) {
    logger.warn('payment.execute_receive.history_unavailable', {
      ...mintUrlFields(operation.mintUrl),
      operationId: operation.id,
    });
  }
  return {
    status: 'finalized' as const,
    historyEntry: JSON.stringify(entry ?? projectReceiveOperation(operation)),
    hadP2PKProofs,
  };
}

/**
 * `executeReceive` through Coco's receive operations, one step at a time.
 *
 * Why this exists:
 *
 * `mgr.wallet.receive(token)` hides Coco's operation lifecycle behind a single
 * promise. That makes a recoverable offline receive look like a terminal
 * receive failure to the UI.
 *
 * We still need the older real-id safeguard too: if the receive finalizes
 * immediately, never let a synthesized id flow through setEntry,
 * linkTransaction, onReceiveConfirmed, or onTransactionCreated.
 *
 * The fix is to use Coco receive ops directly. If the operation reaches
 * `executing` and the mint/network is unreachable, we return Colada's
 * pending result so the screen can wait for recovery. If it finalizes
 * immediately, we look up its exact history row. If the read is unavailable,
 * Coco projects the same row from the finalized operation.
 */
export function createExecuteReceive(
  deps: ReceiveDeps
): NonNullable<MachineOperations['executeReceive']> {
  const getOffline = deps.getOffline ?? (() => false);
  return async ({ tokenString, mintUrl, amount: _amount }) => {
    const manager = deps.getManager();
    if (!manager) {
      logger.error('payment.execute_receive.no_manager');
      throw new Error('Wallet manager is not available');
    }

    // P2PK detection — preserved from coco's default so the downstream
    // onP2PKReceiveCompleted notification still fires for users with
    // `regenerateP2PKOnReceive` enabled.
    let hadP2PKProofs = false;
    try {
      const metadata = getTokenMetadata(tokenString);
      hadP2PKProofs = proofsHaveP2PK(metadata.incompleteProofs);
    } catch (error) {
      logger.warn('payment.execute_receive.p2pk_detection_decode_failed', {
        ...mintUrlFields(mintUrl),
        tokenLength: tokenString.length,
        error: error instanceof Error ? error.message : String(error),
      });
      // proof decode failure — fall back to false (no regression)
    }

    logger.info('payment.execute_receive.start', {
      ...mintUrlFields(mintUrl),
      tokenLength: tokenString.length,
      hadP2PKProofs,
      expectedNext: 'prepare_receive_operation',
    });

    const prepared = await manager.ops.receive.prepare({ token: tokenString });
    // Calculate the offline verdict before any irreversible/network-facing
    // receive work. Online receives may still redeem legacy tokens without
    // DLEQ, but if this run is already offline — or later falls into pending
    // recovery — the cached verdict must be valid before the wallet accepts it.
    let offlineVerificationError: unknown = null;
    try {
      await deps.verifyOfflineReceive(manager, prepared);
    } catch (error) {
      offlineVerificationError = error;
      if (getOffline()) throw error;
    }
    logger.info('payment.execute_receive.prepared', {
      ...mintUrlFields(mintUrl),
      operationId: prepared.id,
      expectedNext: 'execute_or_mark_pending',
    });

    try {
      const finalized = await manager.ops.receive.execute(prepared);
      logger.info('payment.execute_receive.executed', {
        ...mintUrlFields(finalized.mintUrl),
        operationId: finalized.id,
        state: finalized.state,
        expectedNext: 'history_entry_link',
      });
      return finalizedReceiveResult(manager, finalized, hadP2PKProofs);
    } catch (err) {
      let latest: Awaited<ReturnType<Manager['ops']['receive']['get']>> = null;
      try {
        latest = await manager.ops.receive.get(prepared.id);
      } catch (getErr) {
        logger.warn('payment.execute_receive.get_after_error_failed', {
          operationId: prepared.id,
          error: getErr instanceof Error ? getErr.message : String(getErr),
        });
      }

      if (latest?.state === 'finalized') {
        return finalizedReceiveResult(manager, latest, hadP2PKProofs);
      }

      if (latest?.state === 'executing' && isRecoverableReceiveError(err)) {
        // Online receives remain compatible with tokens that omit optional
        // NUT-12 data. Crossing into the offline/pending state is stricter:
        // without a valid DLEQ we cannot know locally that these proofs were
        // issued by this mint, so never present or persist them as accepted.
        if (offlineVerificationError) throw offlineVerificationError;
        logger.info('payment.execute_receive.pending_recovery', {
          ...mintUrlFields(latest.mintUrl),
          operationId: latest.id,
          hadP2PKProofs,
          pendingReason: 'network',
          expectedNext: 'coco_recovery_then_success_toast',
          error: err instanceof Error ? err.message : String(err),
        });
        const pendingEntry = buildPendingReceiveEntry(
          latest,
          tokenString,
          mintUrl,
          _amount,
        );
        return {
          status: 'pending',
          operationId: latest.id,
          historyEntry: JSON.stringify(pendingEntry),
          pendingReason: 'network',
          message: deps.pendingMessage,
          hadP2PKProofs,
        };
      }

      logger.error('payment.execute_receive.failed_terminal', {
        ...mintUrlFields(mintUrl),
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

// ---------------------------------------------------------------------------
// executeMintQuote
// ---------------------------------------------------------------------------

const MINT_QUOTE_PREPARE_TIMEOUT_MS = 10_000;

/**
 * `executeMintQuote` that hands back the history row Coco saved.
 *
 * The plain version in `defaultOperations.ts` prepares the quote and builds
 * the history entry from the returned operation, using `mintOp.id` as the
 * entry id, to avoid a race where getPaginatedHistory runs before
 * HistoryService persists the row. The unspoken risk is that coco's
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
export function createExecuteMintQuote(
  deps: MintQuoteDeps
): NonNullable<MachineOperations['executeMintQuote']> {
  return async ({ mintUrl, amount, unit: _unit, method = 'bolt11' }) => {
    const manager = deps.getManager();
    if (!manager) {
      logger.error('payment.execute_mint_quote.no_manager');
      throw new Error('Wallet manager is not available');
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
      logger.warn('payment.execute_mint_quote.snapshot_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      beforeIds = new Set();
    }

    logger.info('payment.execute_mint_quote.start', {
      ...mintUrlFields(mintUrl),
      amount,
    });
    // coco v2 supports onchain minting (reusable quote, fresh address per
    // call); the poll-for-persisted-row flow below is method-agnostic.
    const mintOp = await withTimeout(
      deps.prepareMintQuote(manager, method === 'onchain' ? 'onchain' : 'bolt11', mintUrl, amount, _unit),
      MINT_QUOTE_PREPARE_TIMEOUT_MS,
      'executeMintQuote.prepare'
    );
    logger.info('payment.execute_mint_quote.prepared', {
      operationId: mintOp.id,
      quoteId: mintOp.quoteId,
    });

    // Constructed entry — used as a fallback (same shape as the plain
    // executeMintQuote) when polling can't find coco's persisted row in time.
    // A freshly prepared bolt11 quote is always UNPAID (v2 moved observed
    // state to the canonical quote row); amount serializes as a number.
    const constructedEntry: Omit<LegacyMintHistoryEntry, 'amount'> & { amount: number } = {
      id: mintOp.id,
      type: 'mint',
      source: 'legacy',
      legacyHistoryId: mintOp.id,
      operationId: mintOp.id,
      createdAt: mintOp.createdAt,
      updatedAt: mintOp.createdAt,
      mintUrl: mintOp.mintUrl,
      unit: mintOp.unit,
      quoteId: mintOp.quoteId,
      state: 'UNPAID',
      amount: amountToNumber(mintOp.amount),
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
        const fromMint = after.filter(
          (h): h is MintHistoryEntry => h.type === 'mint' && h.mintUrl === mintUrl
        );
        const persisted =
          // Preferred: this quote's own row, wherever it sits in the page
          (mintOp.quoteId ? fromMint.find((h) => h.quoteId === mintOp.quoteId) : undefined) ??
          // Fallback: set difference on ids
          fromMint.find((h) => !beforeIds.has(h.id));
        if (persisted) {
          logger.info('payment.execute_mint_quote.found', {
            ...mintUrlFields(mintUrl),
            persistedId: persisted.id,
            constructedId: mintOp.id,
            matchedById: persisted.id === mintOp.id,
            attempts: attempt + 1,
          });
          // Coco's persisted row is authoritative — its `id` is what flows
          // downstream to onTransactionCreated and the scan-history link.
          // Serialize through colada's contract (legacy state vocabulary +
          // numeric amount) so this path matches the timeout fallback below.
          return { historyEntry: serializeHistoryEntry(persisted) };
        }
      } catch (e) {
        logger.warn('payment.execute_mint_quote.poll_failed', {
          attempt,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    // Last resort: the constructed entry. Logged loudly so we know
    // the polling didn't catch the persisted row.
    logger.error('payment.execute_mint_quote.timeout_fallback', {
      ...mintUrlFields(mintUrl),
      operationId: mintOp.id,
      polledMs: MAX_ATTEMPTS * DELAY_MS,
    });
    return { historyEntry: JSON.stringify(constructedEntry) };
  };
}
