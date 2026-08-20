/**
 * @fileoverview Coco Cashu utility functions for ecash operations
 *
 * @module shared/lib/cashu/utils
 *
 * @description
 * **Utility functions for Coco Cashu operations**
 * - Ecash token validation and spendability checks
 * - Receive history entry construction
 *
 * @see {@link https://github.com/bitcoinvault/coco-cashu-core} Coco Cashu Core
 */

import { type Manager } from '@cashu/coco-core';
import { decodeEcashTokenMetadata } from 'wallet';
import type { SyntheticReceiveHistoryEntry } from './syntheticHistory';

import { log, mintUrlLogFields } from '../logger';
import { mintLocalId } from '../id';

/**
 * Builds a `ReceiveHistoryEntry` from a decoded token.
 *
 * Centralises the pattern that was duplicated in ReceiveScreen and UserMessagesScreen —
 * each constructing the same shape manually. Token decoding (amount, mint, unit,
 * P2PK lock) is owned by colada's `decodeEcashTokenMetadata`.
 *
 * @param rawToken  The original encoded token string (stored in metadata for re-encoding)
 * @param unitOverride  Explicit unit; falls back to `decoded.unit ?? 'sat'`
 */
export function buildReceiveHistoryEntry(
  rawToken: string,
  unitOverride?: string
): SyntheticReceiveHistoryEntry {
  log.info('cashu.utils.build_receive_history_entry', { tokenLen: rawToken.length, unitOverride });
  const decoded = decodeEcashTokenMetadata(rawToken);
  if (!decoded) {
    log.error('cashu.utils.build_receive_history_entry.decode_failed', {
      tokenLen: rawToken.length,
      unitOverride,
    });
    throw new Error('Failed to decode ecash token');
  }
  const p2pkPubkey = decoded.p2pkPubkey;
  const amount = decoded.amount;
  log.debug('cashu.utils.build_receive_history_entry.decoded', {
    amount: String(amount),
    ...mintUrlLogFields(decoded.mint),
    hasP2pk: !!p2pkPubkey,
  });
  const now = Date.now();
  const id = mintLocalId('receive');
  return {
    id,
    type: 'receive',
    source: 'legacy',
    legacyHistoryId: id,
    amount,
    unit: unitOverride ?? decoded.unit ?? 'sat',
    mintUrl: decoded.mint,
    createdAt: now,
    updatedAt: now,
    metadata: {
      rawToken,
      ...(p2pkPubkey ? { p2pkPubkey } : {}),
    },
    state: 'prepared',
  };
}

// ============================================================================
// Pending Ecash Send Helpers
// ============================================================================

/**
 * State-aware rollback. Mirrors `attemptRollback` from
 * `colada/src/operations/defaultOperations.ts` so the in-app sweep
 * surface (Transactions) and the offline-payment-rollback path agree on
 * which RPC to call: `cancel` for `prepared`, `reclaim` for `pending`/
 * `executing`. Returns `true` on success, `false` otherwise (errors logged).
 */
export async function attemptRollback(mgr: Manager, operationId: string): Promise<boolean> {
  try {
    const operation = await mgr.ops.send.get(operationId);
    if (operation && operation.state === 'prepared') {
      await mgr.ops.send.cancel(operationId);
    } else if (operation && (operation.state === 'pending' || operation.state === 'executing')) {
      await mgr.ops.send.reclaim(operationId);
    } else {
      log.warn('cashu.utils.rollback.unexpected_state', {
        operationId,
        state: operation?.state ?? null,
      });
      return false;
    }
    return true;
  } catch (error) {
    log.error('cashu.utils.rollback.failed', { operationId, error });
    return false;
  }
}
