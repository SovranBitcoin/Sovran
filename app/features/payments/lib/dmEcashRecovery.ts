/**
 * @fileoverview Recovery for message ecash the redeem queue has parked.
 *
 * The queue's orchestrator never auto-trusts a mint and gives up after a few
 * failed attempts, leaving an entry `untrusted-mint` or `failed`. With no chat
 * bubble to fall back on, those entries need their own way out:
 *
 *  - `parkedMessageEcash` is what the wallet home lists, so the person can open
 *    the token in the ordinary receive screen, add the mint, and redeem.
 *  - `reconcileParkedMessageEcash` puts an entry back in line when its mint
 *    has since been trusted, and clears one whose token was redeemed by hand.
 */

import { CocoManager } from '@/shared/lib/cashu/manager';
import { paymentLog, redactError } from '@/shared/lib/logger';
import { isTokenSpent } from '@/shared/lib/routstr/spentProbe';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

import { parkedMessageEcash } from './parkedMessageEcash';

// Tokens the person opened in the receive screen this session, per profile.
// Opening one is that profile's decision to deal with that mint, and that
// screen contacts it; another profile holding the same token has decided
// nothing. Hashes only, in memory only.
const reviewed = new Set<string>();
const reviewKey = (ownerPubkey: string, tokenHash: string) => `${ownerPubkey}:${tokenHash}`;

export function markMessageEcashReviewed(ownerPubkey: string, tokenHash: string): void {
  reviewed.add(reviewKey(ownerPubkey, tokenHash));
}

/**
 * Bring parked entries up to date. Returns true when any entry went back in
 * line, so the caller knows to drain.
 *
 * A mint is contacted only when the wallet trusts it, or the person has
 * opened that token for review (`markMessageEcashReviewed`): the mint URL
 * came from whoever sent the message.
 *
 * `stillCurrent` guards every write: the store is profile-scoped and read at
 * write time, and the checks below await.
 */
export async function reconcileParkedMessageEcash(
  ownerPubkey: string,
  stillCurrent: () => boolean
): Promise<boolean> {
  if (!CocoManager.isInitialized()) return false;
  const manager = CocoManager.getInstance();
  const current = () => stillCurrent() && CocoManager.getInstance() === manager;
  let requeued = false;
  for (const entry of parkedMessageEcash(useNutDropRedeemQueueStore.getState().byTokenHash)) {
    try {
      const trusted = await manager.mint.isTrustedMint(entry.mintUrl);
      if (!current()) return requeued;
      if (!trusted && !reviewed.has(reviewKey(ownerPubkey, entry.tokenHash))) continue;
      // Spent first: a token redeemed by hand from the receive screen must
      // close here, not go back in line to fail as already redeemed.
      const spent = await isTokenSpent(manager, entry.token);
      if (!current()) return requeued;
      if (spent) {
        useNutDropRedeemQueueStore.getState().markStatus(entry.tokenHash, 'spent');
      } else if (trusted && entry.reason === 'untrusted-mint') {
        useNutDropRedeemQueueStore.getState().requeue(entry.tokenHash);
        requeued = true;
      }
    } catch (error) {
      // One unreachable mint must not stop the rest being reconciled.
      paymentLog.warn('payment.dm_ecash.reconcile_failed', { error: redactError(error) });
    }
  }
  return requeued;
}
