import { z } from 'zod';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { apiLog } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import type { RequestControls } from 'wallet/safeFetch';

/**
 * Sweep every Routstr credential this profile has held back into the wallet.
 *
 * A Routstr key opens a hosted account on ONE node, and the app has changed
 * node twice without moving the money — so sats are sitting on nodes the user
 * can no longer reach through the UI. `POST /v1/balance/refund` hands them back
 * as a Cashu token, which goes straight into Coco.
 *
 * A credential is sent only to its recorded issuing provider. Trying other
 * providers would disclose bearer authority over that balance. Unknown-owner
 * records stay recoverable until their provider can be established.
 * The endpoint replays its last paid refund, so a lost response can be re-asked.
 */

/** Refund payloads are string-encoded amounts, and the unit field depends on
 *  the key's unit (`sats` for sat-denominated keys, `msats` otherwise). */
const RefundSpine = z.looseObject({
  token: z.string().max(65_536).optional(),
  sats: z.string().max(32).optional(),
  msats: z.string().max(32).optional(),
});

function refundUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${trimmed}/v1/balance/refund`;
}

/** Ask one node for one credential's balance. Returns the token when there is
 *  money to collect, `null` when there is definitively nothing here, and
 *  `'retry'` when the answer is not final. */
async function askNode(
  base: string,
  apiKey: string,
  controls: RequestControls
): Promise<string | null | 'retry'> {
  let response: Response;
  try {
    // An arbitrary node base, not the configured one, and the reply is a
    // bearer token rather than an envelope `fetchJson` could validate.
    // eslint-disable-next-line no-restricted-globals -- see the note above
    response = await fetch(refundUrl(base), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
    });
  } catch {
    return 'retry';
  }

  if (!response.ok) {
    apiLog.info('routstr.reclaim.declined', { status: response.status });
    // Only a swept refund is final. In particular, 400 also means ongoing
    // requests and 502 can be a payout still being reconciled by the node.
    return response.status === 410 ? null : 'retry';
  }

  const parsed = RefundSpine.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !parsed.data.token) {
    // An unfamiliar success body is not evidence that the money was received.
    apiLog.warn('routstr.reclaim.no_token');
    return 'retry';
  }
  return parsed.data.token;
}

/**
 * Chase the change for payments the app never finished collecting.
 *
 * The dangerous window in pay-per-request is between handing a token to a node
 * and reading the change out of its response header. Die there — force quit,
 * crash, OS reclaim — and the header never arrives. routstr closes it: its
 * refund endpoint takes the ORIGINAL token in `X-Cashu` and returns that
 * request's change (`routstr/balance.py`), so a payment recorded before it
 * left can always be asked about again.
 *
 * The four answers are all distinct and all matter:
 *   200 — here is the change. Bank it, forget the row.
 *   404 — this node never saw the token. It was never spent, so undo the send.
 *   425 — the upstream request is still running. Ask again later.
 *   410 — the refund was swept. Nothing to collect; stop asking.
 */
export async function recoverPendingPayments(controls: RequestControls = {}): Promise<number> {
  const manager = CocoManager.peekInstance();
  if (!manager) return 0;
  const owner = useProfileStore.getState().activeAccountIndex;
  const ownsScope = () =>
    !controls.signal?.aborted &&
    useProfileStore.getState().activeAccountIndex === owner &&
    CocoManager.peekInstance() === manager;

  const store = useRoutstrStore.getState();
  const pending = Object.entries(store.pendingPayments);
  if (pending.length === 0) return 0;

  let recovered = 0;
  for (const [id, payment] of pending) {
    if (!ownsScope()) break;
    let response: Response;
    try {
      // An arbitrary node base, and the reply is a bearer token rather than a
      // validatable envelope.
      // eslint-disable-next-line no-restricted-globals -- see the note above
      response = await fetch(refundUrl(payment.nodeBaseUrl), {
        method: 'POST',
        headers: { 'X-Cashu': payment.encoded, 'Content-Type': 'application/json' },
        body: '{}',
        signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
      });
    } catch {
      continue; // offline; the row survives for the next sweep
    }
    if (!ownsScope()) break;

    if (response.status === 404) {
      // The node has no record of this token, so it was never redeemed. The
      // proofs are still ours — give them back to the wallet.
      try {
        await manager.ops.send.reclaim(payment.operationId);
        if (!ownsScope()) break;
        useRoutstrStore.getState().settlePayment(id);
        apiLog.info('routstr.payment.recovered_unspent', { operationId: payment.operationId });
      } catch (error) {
        apiLog.warn('routstr.payment.recover_reclaim_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    if (response.status === 410) {
      apiLog.warn('routstr.payment.change_swept', { startedAt: payment.startedAt });
      useRoutstrStore.getState().settlePayment(id);
      continue;
    }
    if (!response.ok) continue; // 425 and anything else: try again later

    const parsed = RefundSpine.safeParse(await response.json().catch(() => null));
    if (!ownsScope()) break;
    if (!parsed.success || !parsed.data.token) continue;
    try {
      const prepared = await manager.ops.receive.prepare({ token: parsed.data.token });
      if (!ownsScope()) break;
      await manager.ops.receive.execute(prepared);
      if (!ownsScope()) break;
      useRoutstrStore.getState().settlePayment(id);
      recovered += 1;
      apiLog.info('routstr.payment.change_recovered', { startedAt: payment.startedAt });
    } catch (error) {
      // Leave the row: the refund is idempotent, so the next sweep re-asks.
      apiLog.error('routstr.payment.change_receive_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (recovered > 0) apiLog.info('routstr.payment.recovery_swept', { recovered });
  return recovered;
}

interface ReclaimOutcome {
  /** Credentials examined this pass. */
  attempted: number;
  /** Credentials whose balance is now in the wallet. */
  reclaimed: number;
  /** Credentials whose answer was not final; the next pass tries again. */
  deferred: number;
}

/**
 * Run one sweep. Safe to call repeatedly — a reclaimed row is skipped, and the
 * refund endpoint is idempotent for the rest.
 *
 * Triggered on app foreground rather than a timer: a suspended mobile process
 * never runs timers, which is why routstrd's 42-minute sweep is the wrong shape
 * here.
 */
export async function reclaimRoutstrBalances(
  controls: RequestControls = {}
): Promise<ReclaimOutcome> {
  const manager = CocoManager.peekInstance();
  if (!manager) return { attempted: 0, reclaimed: 0, deferred: 0 };
  const owner = useProfileStore.getState().activeAccountIndex;
  const ownsScope = () =>
    !controls.signal?.aborted &&
    useProfileStore.getState().activeAccountIndex === owner &&
    CocoManager.peekInstance() === manager;

  const state = useRoutstrStore.getState();
  const pending = Object.entries(state.legacyAccounts).filter(
    ([, account]) => account.reclaimedAt == null && account.apiKey
  );
  if (pending.length === 0) return { attempted: 0, reclaimed: 0, deferred: 0 };

  const outcome: ReclaimOutcome = { attempted: pending.length, reclaimed: 0, deferred: 0 };

  for (const [nodeKey, account] of pending) {
    if (!ownsScope()) break;
    const node = account.nodeBaseUrl ?? nodeKey;
    if (!z.httpUrl().safeParse(node).success) {
      outcome.deferred += 1;
      continue;
    }

    const result = await askNode(node, account.apiKey, controls);
    if (!ownsScope()) break;
    if (result === 'retry') {
      outcome.deferred += 1;
      continue;
    }
    if (result === null) {
      // The issuing node reports a terminal result. Retain the credential.
      useRoutstrStore.getState().markAccountReclaimed(nodeKey);
      continue;
    }
    try {
      const prepared = await manager.ops.receive.prepare({ token: result });
      if (!ownsScope()) break;
      await manager.ops.receive.execute(prepared);
      if (!ownsScope()) break;
      useRoutstrStore.getState().markAccountReclaimed(nodeKey);
      outcome.reclaimed += 1;
      apiLog.info('routstr.reclaim.collected', { node });
    } catch {
      // The provider can replay the refund on the next pass.
      apiLog.error('routstr.reclaim.receive_failed');
      outcome.deferred += 1;
    }
  }

  apiLog.info('routstr.reclaim.swept', { ...outcome });
  return outcome;
}
