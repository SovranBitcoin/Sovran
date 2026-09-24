import { z } from 'zod';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { apiLog } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import type { RequestControls } from 'wallet/safeFetch';

/**
 * Sweep every Routstr credential this profile has held back into the wallet.
 *
 * A Routstr key opens a hosted account on ONE node, and the app has changed
 * node twice without moving the money — so sats are sitting on nodes the user
 * can no longer reach through the UI. `POST /v1/balance/refund` hands them back
 * as a Cashu token, which goes straight into Coco.
 *
 * Two properties make a blind sweep safe, both from routstr-core's
 * `routstr/balance.py`:
 *
 *   - `_lookup_key_no_create` deliberately does NOT create a key, so asking a
 *     node that never issued this credential costs nothing and answers
 *     `401 key_not_found`. We therefore do not need to know which node a key
 *     belongs to — which is just as well, because a repoint can move
 *     `nodeBaseUrl` out from under a credential before anything records it.
 *   - The endpoint is idempotent: a zero-balance key with no open claim
 *     replays its last paid refund rather than erroring, so a lost response can
 *     simply be re-asked.
 */

/**
 * Nodes to ask, beyond whatever the archive believes. These are the two the app
 * has actually pointed at: `api.routstr.com` was the built-in default (its
 * `/v1/models` and `/v1/info` 404 today, but its refund route answers), and
 * `ai.redsh1ft.com` was first in nagg's compiled fallback ladder. Most existing
 * deposits are on one of them.
 */
const HISTORICAL_NODES = ['https://api.routstr.com', 'https://ai.redsh1ft.com'] as const;

/** Refund payloads are string-encoded amounts, and the unit field depends on
 *  the key's unit (`sats` for sat-denominated keys, `msats` otherwise). */
const RefundSpine = z.looseObject({
  token: z.string().max(65_536).optional(),
  sats: z.string().max(32).optional(),
  msats: z.string().max(32).optional(),
});

/** Whether asking this node again later could produce a different answer.
 *  Mapped from `routstr/balance.py` + `routstr/refund.py`; the distinction is
 *  the whole point, because retrying a terminal state burns requests and
 *  retrying nothing loses money. */
function isRetryable(status: number): boolean {
  // 425 refund pending (carries Retry-After), 409 a claim is already settling,
  // 500 payout failed before dispatch (balance restored), 503 mint unreachable.
  if (status === 425 || status === 409 || status === 500 || status === 503) return true;
  // 410 swept, 502 dispatched-but-unconfirmed (retrying risks a double spend —
  // routstr reconciles it in the background), 400 dust or no balance,
  // 401 this node never issued the key.
  return false;
}

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
    return isRetryable(response.status) ? 'retry' : null;
  }

  const parsed = RefundSpine.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !parsed.data.token) {
    // A 200 with no token is a refund that settled to a lightning address, or
    // a shape we do not know. Either way there is nothing to receive here.
    apiLog.warn('routstr.reclaim.no_token');
    return null;
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

  const store = useRoutstrStore.getState();
  const pending = Object.entries(store.pendingPayments);
  if (pending.length === 0) return 0;

  let recovered = 0;
  for (const [id, payment] of pending) {
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

    if (response.status === 404) {
      // The node has no record of this token, so it was never redeemed. The
      // proofs are still ours — give them back to the wallet.
      try {
        await manager.ops.send.reclaim(payment.operationId);
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
    if (!parsed.success || !parsed.data.token) continue;
    try {
      const prepared = await manager.ops.receive.prepare({ token: parsed.data.token });
      await manager.ops.receive.execute(prepared);
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

  const state = useRoutstrStore.getState();
  const pending = Object.entries(state.legacyAccounts).filter(
    ([, account]) => account.reclaimedAt == null && account.apiKey
  );
  if (pending.length === 0) return { attempted: 0, reclaimed: 0, deferred: 0 };

  const outcome: ReclaimOutcome = { attempted: pending.length, reclaimed: 0, deferred: 0 };

  for (const [nodeKey, account] of pending) {
    // The archive's node key is a hint. Ask it first, then everywhere else we
    // know of — a key only exists on the node that redeemed it, and asking the
    // others is free.
    const bases = Array.from(
      new Set(
        [nodeKey, state.nodeBaseUrl, ...HISTORICAL_NODES].filter(
          (b): b is string => typeof b === 'string' && b.startsWith('http')
        )
      )
    );

    let collected = false;
    let deferred = false;
    for (const base of bases) {
      const result = await askNode(base, account.apiKey, controls);
      if (result === 'retry') {
        deferred = true;
        continue;
      }
      if (result == null) continue;
      try {
        // Same two-step the receive flow uses (`sovranPaymentConfig.ts:334`).
        // The offline-DLEQ guard that sits between them there does not apply:
        // it exists because Sovran can accept a stranger's token while offline,
        // and this token arrived over TLS from a node we just chose, on a path
        // that cannot run offline at all.
        const prepared = await manager.ops.receive.prepare({ token: result });
        await manager.ops.receive.execute(prepared);
        collected = true;
        apiLog.info('routstr.reclaim.collected', { node: base });
        break;
      } catch (error) {
        // The token is real and unredeemed; leaving the row unreclaimed means
        // the next sweep re-asks, and routstr replays the same refund.
        apiLog.error('routstr.reclaim.receive_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        deferred = true;
      }
    }

    if (collected) {
      useRoutstrStore.getState().markAccountReclaimed(nodeKey);
      outcome.reclaimed += 1;
    } else if (deferred) {
      outcome.deferred += 1;
    } else {
      // Every node we know of says this credential holds nothing. Stop asking.
      useRoutstrStore.getState().markAccountReclaimed(nodeKey);
    }
  }

  apiLog.info('routstr.reclaim.swept', { ...outcome });
  return outcome;
}
