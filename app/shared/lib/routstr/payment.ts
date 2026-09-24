import { getEncodedToken, getTokenMetadata } from '@cashu/cashu-ts';

import { apiLog } from '@/shared/lib/logger';

/**
 * Paying Routstr per request, out of the wallet.
 *
 * Routstr has two payment modes. The hosted account — deposit once, spend down
 * a balance keyed to one node — is the one that stranded money: the key is a
 * row in that node's database, so a node change left the balance behind. The
 * other mode, `X-Cashu`, carries a Cashu token on the request itself. The node
 * redeems it, does the work, and returns the change as a fresh token in the
 * response header. Nothing is held anywhere, so nothing can be stranded, and
 * switching provider costs the user nothing.
 *
 * This module is the wallet half of that: mint the token, take the change back,
 * and undo the mint when the request never happened.
 */

/**
 * Lazy access to the wallet and the selected mint.
 *
 * Static imports here would pull the Coco manager and the profile-scoped mint
 * store into `api.ts`'s module graph, which every Routstr consumer loads —
 * including tests that have no business booting a wallet. Same reasoning, and
 * the same `require` form, as `routstrStoreState()` in `api.ts`: Metro handles
 * both spellings but Jest's CJS VM only executes this one.
 */
function wallet() {
  const { CocoManager } =
    require('@/shared/lib/cashu/manager') as typeof import('@/shared/lib/cashu/manager');
  return CocoManager.peekInstance();
}

function selectedMintUrl(): string | undefined {
  const { useMintStore } =
    require('@/shared/stores/profile/mintStore') as typeof import('@/shared/stores/profile/mintStore');
  return useMintStore.getState().selectedMint;
}

function routstrStoreState() {
  const { useRoutstrStore } =
    require('@/shared/stores/profile/routstrStore') as typeof import('@/shared/stores/profile/routstrStore');
  return useRoutstrStore.getState();
}

interface RequestPayment {
  /** Encoded Cashu token for the `X-Cashu` header. */
  encoded: string;
  /** Coco send operation, so an unspent token can be undone. */
  operationId: string;
  mintUrl: string;
  amountSats: number;
  /** Key of the `pendingPayments` row that keeps this recoverable. */
  id: string;
}

/**
 * Mint a token worth `amountSats` for one request.
 *
 * The amount has to clear the node's admission gate — routstr rejects an
 * under-funded token before it forwards anything (`minimum_balance_required`)
 * — so callers pass the gate figure, not the expected cost. Whatever the
 * request does not consume comes back as change.
 */
export async function mintRequestPayment(
  amountSats: number,
  nodeBaseUrl: string
): Promise<RequestPayment> {
  const manager = wallet();
  if (!manager) throw new Error('wallet is not ready');
  const mintUrl = selectedMintUrl();
  if (!mintUrl) throw new Error('no mint selected');

  const prepared = await manager.ops.send.prepare({ mintUrl, amount: amountSats, unit: 'sat' });
  const { operation, token } = await manager.ops.send.execute(prepared);
  const encoded = getEncodedToken(token);
  // Recorded BEFORE it leaves. Between here and the change header the money is
  // in the node's hands with no local trace; if the app dies in that window
  // this row is the only way back, because routstr will refund against the
  // original token.
  routstrStoreState().beginPayment(operation.id, {
    encoded,
    nodeBaseUrl,
    operationId: operation.id,
    startedAt: Date.now(),
  });
  apiLog.info('routstr.payment.minted', { amountSats, operationId: operation.id });
  return { encoded, operationId: operation.id, mintUrl, amountSats, id: operation.id };
}

/** Face value of an encoded token, in sats. Reading it from the proofs rather
 *  than from the receive result means the figure is known even if banking it
 *  has to be retried. */
function tokenValueSats(encoded: string): number {
  try {
    return getTokenMetadata(encoded).amount.toNumber();
  } catch {
    return 0;
  }
}

/**
 * Put the node's change back in the wallet, and report what it was worth.
 *
 * Routstr returns change on error responses too, so this runs on the failure
 * path as well — a refused request that still handed money back must not leave
 * it on the floor.
 *
 * The returned figure is what makes a request's cost EXACT: spent minus
 * returned is what the node actually took, with no estimate and no balance
 * diff that a concurrent write could corrupt.
 */
export async function receiveChange(encoded: string): Promise<number> {
  const manager = wallet();
  if (!manager) throw new Error('wallet is not ready');
  const sats = tokenValueSats(encoded);
  const prepared = await manager.ops.receive.prepare({ token: encoded });
  await manager.ops.receive.execute(prepared);
  apiLog.info('routstr.payment.change_received', { sats });
  return sats;
}

/**
 * Undo a payment the node never took.
 *
 * Only for the case where the request failed with no change header at all —
 * a transport error, or a refusal before redemption. If the node DID redeem
 * the token this is a no-op by construction: the proofs are spent, so the
 * reclaim finds nothing to return, and the change header is the only route
 * back. Failure here is not fatal; `ops.send.recovery` sweeps the operation at
 * next launch, which is why it is logged rather than thrown.
 */
export async function reclaimUnspentPayment(payment: RequestPayment): Promise<void> {
  const manager = wallet();
  if (!manager) return;
  try {
    await manager.ops.send.reclaim(payment.operationId);
    routstrStoreState().settlePayment(payment.id);
    apiLog.info('routstr.payment.reclaimed', { operationId: payment.operationId });
  } catch (error) {
    // Left pending on purpose: the recovery sweep asks the node whether it
    // took this token, which is the question a local reclaim failure cannot
    // answer.
    apiLog.warn('routstr.payment.reclaim_deferred', {
      operationId: payment.operationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
