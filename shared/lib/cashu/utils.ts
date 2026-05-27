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

import {
  type HistoryEntry,
  type Manager,
  type ReceiveHistoryEntry,
  type SendHistoryEntry,
} from '@cashu/coco-core';
import { getTokenMetadata } from '@cashu/cashu-ts';

import { log } from '../logger';
import { mintLocalId } from '../id';
import { amountToNumber } from './amount';

/**
 * Validates if a string is a valid ecash token by attempting to decode it
 *
 * @description Checks if the provided string can be successfully decoded as an ecash token
 *
 * **Process:** getTokenMetadata() → return success/failure
 * **Effects:** None (pure validation function)
 *
 * @param {string} token - The token string to validate
 * @returns {boolean} True if token is valid, false otherwise
 *
 * @example
 * const token = 'cashuAeyJ0b2tlbiI6...';
 * const isValid = isValidEcashToken(token);
 * if (isValid) {
 *   // Process valid token
 * }
 */
export function isValidEcashToken(token: string): boolean {
  try {
    getTokenMetadata(token);
    log.debug('cashu.utils.validate_ecash_token', { valid: true, tokenLen: token.length });
    return true;
  } catch {
    log.debug('cashu.utils.validate_ecash_token', { valid: false, tokenLen: token.length });
    return false;
  }
}

// ============================================================================
// Ecash Token Helpers
// ============================================================================

/**
 * Extracts the amount in sats from an ecash token.
 */
export function getEcashTokenAmount(token: string): number | undefined {
  try {
    const decoded = getTokenMetadata(token);
    const amount = amountToNumber(decoded.amount);
    log.debug('cashu.utils.get_ecash_token_amount', {
      amount,
      proofCount: decoded.incompleteProofs.length,
      mint: decoded.mint,
    });
    return amount;
  } catch {
    log.warn('cashu.utils.get_ecash_token_amount.decode_failed', { tokenLen: token.length });
    return undefined;
  }
}

/**
 * Extracts the P2PK public key from proofs, if any proof uses P2PK locking.
 * Returns the first P2PK data field found, or null.
 */
function extractP2PKPubkey(proofs: readonly { secret: string }[]): string | null {
  for (const proof of proofs) {
    try {
      const parsed = JSON.parse(proof.secret);
      if (Array.isArray(parsed) && parsed[0] === 'P2PK' && parsed[1]?.data) {
        return parsed[1].data as string;
      }
    } catch {
      // not a structured secret
    }
  }
  return null;
}

/**
 * Builds a `ReceiveHistoryEntry` from a decoded token.
 *
 * Centralises the pattern that was duplicated in ReceiveScreen and UserMessagesScreen —
 * each constructing the same shape manually.
 *
 * @param rawToken  The original encoded token string (stored in metadata for re-encoding)
 * @param unitOverride  Explicit unit; falls back to `decodedToken.unit ?? 'sat'`
 */
export function buildReceiveHistoryEntry(
  rawToken: string,
  unitOverride?: string
): ReceiveHistoryEntry & { source: 'legacy'; legacyHistoryId: string; updatedAt: number } {
  log.info('cashu.utils.build_receive_history_entry', { tokenLen: rawToken.length, unitOverride });
  const decodedToken = getTokenMetadata(rawToken);
  const p2pkPubkey = extractP2PKPubkey(decodedToken.incompleteProofs);
  const amount = amountToNumber(decodedToken.amount);
  log.debug('cashu.utils.build_receive_history_entry.decoded', {
    amount: String(amount),
    proofCount: decodedToken.incompleteProofs.length,
    mint: decodedToken.mint,
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
    unit: unitOverride ?? decodedToken.unit ?? 'sat',
    mintUrl: decodedToken.mint,
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
 * Send-operation states that can be rolled back. `prepared` operations need
 * `cancel`; `pending`/`executing` need `reclaim` (see `attemptRollback`).
 */
const CANCELLABLE_SEND_STATES = new Set(['pending', 'prepared']);

/**
 * Type guard: a history entry that can be cancelled by the user via swipe
 * or the bulk-sweep button on Transactions.
 */
export function isCancellablePendingEcash(entry: HistoryEntry): entry is SendHistoryEntry {
  return entry.type === 'send' && CANCELLABLE_SEND_STATES.has((entry as SendHistoryEntry).state);
}

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
