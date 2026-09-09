import type { Manager, MintOperation } from '@cashu/coco-core';
import { cashuLog, mintUrlLogFields } from '@/shared/lib/logger';

/** Wait for this transfer's persisted recipient operation, never an unrelated deposit. */
export async function waitForRebalanceMint(
  manager: Manager,
  expected: MintOperation,
  maxWaitMs: number,
  isCancelled: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (!isCancelled() && Date.now() < deadline) {
    const operation = await manager.ops.mint.get(expected.id).catch((error) => {
      cashuLog.warn('mint.rebalance.recipient_operation_read_failed', {
        ...mintUrlLogFields(expected.mintUrl),
        operationId: expected.id,
        error,
      });
      return null;
    });
    if (isCancelled()) return false;
    if (
      operation?.id === expected.id &&
      operation.mintUrl === expected.mintUrl &&
      operation.quoteId === expected.quoteId &&
      operation.method === expected.method &&
      operation.unit === expected.unit &&
      operation.amount.equals(expected.amount) &&
      operation.state === 'finalized' &&
      !operation.error
    ) {
      // Coco can finalize ALREADY_ISSUED with an error when proofs could not
      // be restored. Only a clean finalization confirms its output persistence.
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1000, Math.max(0, deadline - Date.now())))
    );
  }
  return false;
}
