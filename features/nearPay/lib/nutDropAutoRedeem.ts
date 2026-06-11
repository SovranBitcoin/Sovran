import { AppState } from 'react-native';
import { NetworkError, HttpResponseError } from '@cashu/coco-core';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { paymentLog } from '@/shared/lib/logger';
import { nutDropReceivedPopup } from '@/shared/lib/popup';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

/**
 * Drains the persisted Nut Drop redeem queue: every `pending` entry past its
 * backoff window is redeemed via `manager.wallet.receive` — a deliberate
 * direct coco call (sanctioned exception to the "ride colada" rule: this is
 * a background wallet operation with no screen to drive; it mirrors
 * colada's own executeReceive, and coco auto-detects the P2PK lock and
 * signs from the keyring where the profile's Nostr key is already imported).
 *
 * Gates, in order:
 * 1. Manager initialized — never touch the wallet mid-profile-switch.
 * 2. NUT-13 restore settled ('complete'/'not-needed') — receives swap with
 *    deterministic counters; redeeming mid-restore desyncs them.
 * 3. Mint trust — coco's `wallet.receive` AUTO-TRUSTS unknown mints
 *    (addMintByUrl trusted:true). Without this gate a hostile mesh message
 *    could inject an arbitrary mint into the wallet. Untrusted-mint drops
 *    park in the queue for the user's manual review flow instead.
 */

/** Single-flight latch — drain triggers overlap (message, AppState, online). */
let inFlight = false;

function classifyReceiveError(err: unknown): 'spent' | 'network' | 'retryable' | 'fatal' {
  const message = err instanceof Error ? err.message : String(err);
  if (/already.{0,8}spent|token.{0,8}spent|11001/i.test(message)) return 'spent';
  if (err instanceof NetworkError) return 'network';
  if (err instanceof HttpResponseError && err.status >= 500) return 'network';
  if (err instanceof Error && err.name === 'MintFetchError') return 'network';
  if (/network|timeout|timed out|fetch failed|abort/i.test(message)) return 'network';
  // Manager/keyring races (e.g. key pair not registered yet) — retry later.
  if (/key pair not found/i.test(message)) return 'retryable';
  return 'fatal';
}

function restoreSettled(): boolean {
  const status = useWalletLifecycleStore.getState().restoreStatus;
  return status === 'complete' || status === 'not-needed';
}

export async function drainNutDropRedeemQueue(): Promise<void> {
  if (inFlight) return;
  if (!CocoManager.isInitialized()) return;
  if (!restoreSettled()) {
    paymentLog.debug('near_pay.redeem.waiting_for_restore');
    return;
  }

  inFlight = true;
  try {
    const manager = CocoManager.getInstance();
    const queue = useNutDropRedeemQueueStore.getState();
    queue.prune();

    const now = Date.now();
    const due = Object.entries(queue.byTokenHash).filter(
      ([, entry]) => entry.status === 'pending' && entry.nextAttemptAt <= now
    );
    if (due.length === 0) return;

    paymentLog.info('near_pay.redeem.drain_start', { dueCount: due.length });

    for (const [tokenHash, entry] of due) {
      const { markStatus, scheduleRetry } = useNutDropRedeemQueueStore.getState();

      let trusted: boolean;
      try {
        trusted = await manager.mint.isTrustedMint(entry.mintUrl);
      } catch (err) {
        scheduleRetry(tokenHash, err instanceof Error ? err.message : String(err));
        continue;
      }
      if (!trusted) {
        // Never auto-trust a mint pushed at us over the mesh. The entry stays
        // visible (status untrusted-mint) for a future manual review surface.
        markStatus(tokenHash, 'untrusted-mint');
        paymentLog.warn('near_pay.redeem.untrusted_mint', {
          tokenHash: tokenHash.slice(0, 12),
          mintUrl: entry.mintUrl,
        });
        continue;
      }

      markStatus(tokenHash, 'redeeming');
      try {
        await manager.wallet.receive(entry.token);
        markStatus(tokenHash, 'redeemed');
        paymentLog.info('near_pay.redeem.success', {
          tokenHash: tokenHash.slice(0, 12),
          amount: entry.amount,
          mintUrl: entry.mintUrl,
        });
        // Toast only when the user can see it; backgrounded redeems surface
        // through the transaction history (coco persists the receive entry).
        if (AppState.currentState === 'active') {
          nutDropReceivedPopup({ amount: entry.amount, unit: entry.unit });
        }
      } catch (err) {
        const kind = classifyReceiveError(err);
        const message = err instanceof Error ? err.message : String(err);
        paymentLog.warn('near_pay.redeem.attempt_failed', {
          tokenHash: tokenHash.slice(0, 12),
          kind,
          error: message,
        });
        if (kind === 'spent') {
          // Duplicate delivery race (we already redeemed an equivalent token)
          // or sender reclaimed. Silent — nothing actionable for the user.
          markStatus(tokenHash, 'spent', message);
        } else if (kind === 'network' || kind === 'retryable') {
          scheduleRetry(tokenHash, message);
        } else {
          markStatus(tokenHash, 'failed', message);
        }
      }
    }
  } finally {
    inFlight = false;
  }
}
