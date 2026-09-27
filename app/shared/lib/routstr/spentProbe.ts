import { CheckStateEnum, Wallet, getTokenMetadata } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';

import { apiLog } from '@/shared/lib/logger';

/**
 * Whether the mint has already redeemed every proof in a token.
 *
 * Recovery asks the wallet to receive tokens it cannot be sure are still good:
 * the request token the SDK tries to take back after a failed call, a refund a
 * node replays. When the node kept the payment, or the refund was banked on an
 * earlier pass, the mint answers "Token already spent" — and Coco, rightly,
 * records every receive it is asked to make. Each of those became a rolled-back
 * receive in the history, one per attempt, for money that was never coming.
 *
 * So the question is put to the mint first (NUT-07), and the wallet is asked to
 * receive only what the mint says is still there. This asks less of Coco, not
 * more, and changes nothing about what it does with a token it is given.
 *
 * `false` whenever spent-ness is not established — the mint did not answer, a
 * proof is unspent or pending, the token would not decode. The wallet then
 * decides, exactly as it did before.
 */
const PROBE_TIMEOUT_MS = 10_000;

export async function isTokenSpent(manager: Manager, token: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { mint } = getTokenMetadata(token);
    const states = await Promise.race([
      (async () => {
        // Coco resolves the short keyset ids a V4 token carries; the state
        // check itself needs only the secrets and is the mint's to answer.
        const decoded = await manager.wallet.decodeToken(token, mint);
        if (decoded.proofs.length === 0) return null;
        const answered = await new Wallet(mint).checkProofsStates(decoded.proofs);
        return answered.length === decoded.proofs.length ? answered : null;
      })(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
      }),
    ]);
    if (!states) return false;
    const spent = states.every((state) => state.state === CheckStateEnum.SPENT);
    if (spent) apiLog.info('routstr.recovery.token_already_spent', { proofs: states.length });
    return spent;
  } catch (error) {
    apiLog.debug('routstr.recovery.spent_probe_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** What the mint says when asked to redeem a spent token, so a caller that
 *  skipped the receive reports the same thing the receive would have. */
export const TOKEN_ALREADY_SPENT_MESSAGE = 'Token already spent';
