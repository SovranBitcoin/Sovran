/**
 * @fileoverview Sovran-side colada operation overrides — receive + mint quote.
 *
 * The two funds-execution operations where Sovran replaces colada's defaults to
 * fix history-id races and offline-receive recovery:
 *
 * - createSovranExecuteReceive: drives Coco receive ops directly so a
 *   recoverable offline receive returns a `pending` result (not a terminal
 *   failure), and an immediate finalize is keyed to Coco's real persisted id
 *   rather than a synthesized one.
 * - createSovranExecuteMintQuote: snapshots mint ids, then resolves Coco's
 *   persisted row by quoteId (deterministic) with a set-difference fallback, so
 *   the downstream location stamp / scan-history link key to the id
 *   `usePaginatedHistory` later returns.
 *
 * Both are funds-critical; the dual snapshot→poll→fallback shape is the
 * race-window guard and must be preserved.
 */
import { getTokenMetadata } from '@cashu/cashu-ts';
import type {
  HistoryEntry,
  Manager,
  MintHistoryEntry,
  ReceiveHistoryEntry,
} from '@cashu/coco-core';
import {
  classifyMeshRedeemError,
  withTimeout,
  type MachineOperations,
} from '@sovranbitcoin/colada';

import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import { prepareBolt11MintQuote } from '@/shared/lib/cashu/cocoOperations';
import { mintLocalId } from '@/shared/lib/id';
import { paymentLog } from '@/shared/lib/logger';
import { RECEIVE_PENDING_TOAST_COPY } from '@/shared/lib/popup/paymentStatusCopy';

import { mintUrlLogFields } from '@/shared/lib/mintUrlLog';

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
 * colada's default `executeReceive` calls `mgr.wallet.receive(token)`, which
 * hides Coco's operation lifecycle behind a single promise. That makes a
 * recoverable offline receive look like a terminal receive failure to the UI.
 *
 * We still need the older real-id safeguard too: if the receive finalizes
 * immediately, never let a synthesized id flow through setEntry,
 * linkTransaction, onReceiveConfirmed, or onTransactionCreated.
 *
 * The fix is to use Coco receive ops directly. If the operation reaches
 * `executing` and the mint/network is unreachable, we return Colada's pending
 * result so the screen can wait for recovery. If it finalizes immediately, we
 * still poll Coco history and use its real persisted id.
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

const MINT_QUOTE_PREPARE_TIMEOUT_MS = 10_000;

/**
 * Sovran-side override for colada's default `executeMintQuote`.
 *
 * colada's default (defaultOperations.ts:275) calls `mgr.ops.mint.prepare(...)`
 * and constructs the history entry directly from the returned operation, using
 * `mintOp.id` as the entry id. The unspoken risk is that coco's persisted row
 * may end up with a different id (or shape) than `mintOp.id`; when that happens
 * the location stamp captured at onTransactionCreated (under `mintOp.id`) and
 * the scan-history link end up keyed to an id that doesn't match what
 * `usePaginatedHistory` returns later — same class of bug as the receive case.
 *
 * Fix: snapshot mint ids for this mintUrl before prepare, then poll coco
 * history for the persisted row by `quoteId` (deterministic — no race) and fall
 * back to set-difference. Use coco's persisted row as authoritative for the id,
 * while preserving `paymentRequest` from the operation result so the
 * LightningReceiveScreen still has a lightning invoice to display.
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
