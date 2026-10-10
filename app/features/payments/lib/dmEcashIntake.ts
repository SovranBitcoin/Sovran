/**
 * @fileoverview Ecash that arrives as a Nostr direct message.
 *
 * Sending ecash to a contact delivers the token as a message. The recipient
 * used to redeem it from its bubble in the conversation, which tied receiving
 * money to having a chat screen. This turns such a message into a queue entry
 * for the same redeem orchestrator Nut Drop uses, so it is received whether or
 * not any conversation is ever opened.
 *
 * Pure decision logic: what to enqueue and why. The hook that feeds it
 * (`useDmEcashAutoRedeem`) owns fetching, decrypting and draining.
 */

import { classifyMeshToken, isValidEcashToken, meshTokenDedupeKey } from 'wallet';

import { NUT_DROP_QUEUE_LIMITS } from '@/shared/stores/profile/nutDropRedeemQueueStore';

/** The fields of a decrypted DM this module reads. */
interface IncomingDm {
  content: string;
  isOwn: boolean;
  senderPubkey: string;
}

export interface DmEcashQueuePort {
  /** True when the token hash is already known (queued, redeemed or spent). */
  has(tokenHash: string): boolean;
  enqueue(
    tokenHash: string,
    entry: {
      token: string;
      mintUrl: string;
      amount: number;
      unit: string;
      source: 'nostr';
      senderPubkey: string;
    }
  ): boolean;
  /** Record a token as already spent, so it is never probed or shown again. */
  markSpent(tokenHash: string): void;
  /** Hold the entry for review: its mint is not trusted. */
  park(tokenHash: string): void;
}

type DmEcashOutcome =
  | 'queued'
  | 'already-known'
  | 'already-spent'
  | 'not-a-token'
  | 'own-message'
  | 'locked-to-other'
  | 'no-mint'
  | 'needs-review'
  | 'unsupported'
  | 'abandoned';

/**
 * Decide what one message means for the redeem queue.
 *
 * `isSpent` is asked before queueing because the first sweep reads history: a
 * token the person redeemed weeks ago from its bubble must not surface a
 * "receiving" toast and then fail. A probe that cannot answer (`null`) queues
 * the token anyway; the orchestrator handles an already-spent token safely,
 * and not queueing would risk leaving real money unclaimed.
 */
export async function intakeDmEcash(
  dm: IncomingDm,
  deps: {
    /** 33-byte compressed P2PK key of this wallet, hex. */
    myPubkey33: string;
    queue: DmEcashQueuePort;
    /**
     * Whether this wallet trusts the mint. `null` when it cannot be asked yet.
     * Asked before anything touches the network: the mint URL in a message is
     * chosen by whoever sent it.
     */
    isTrustedMint(mintUrl: string): Promise<boolean | null>;
    /** Asks the mint. Only ever called for a trusted mint. */
    isSpent(token: string): Promise<boolean | null>;
    /**
     * False once the wallet this pass started for is no longer the active one.
     * The queue is profile-scoped storage read at write time, so a profile
     * switch during the spent probe would otherwise file this token, and later
     * redeem it, into a different wallet.
     */
    stillCurrent(): boolean;
  }
): Promise<DmEcashOutcome> {
  if (dm.isOwn) return 'own-message';
  // Only a message that IS a token. A token quoted inside a sentence is
  // conversation, not a payment addressed to this wallet.
  // The whole message is tested, not a token found within it: the chat's
  // extractor stops at 10,000 characters, and a token of many proofs is longer.
  const token = dm.content.trim();
  if (!isValidEcashToken(token)) return 'not-a-token';

  const classified = classifyMeshToken(token, deps.myPubkey33);
  if (classified.classification === 'locked-to-other') return 'locked-to-other';
  if (!classified.mintUrl) return 'no-mint';

  const tokenHash = meshTokenDedupeKey(token);
  if (deps.queue.has(tokenHash)) return 'already-known';

  const unit = classified.unit ?? 'sat';
  // What the queue stores has limits, and one entry past them fails the whole
  // stored queue on the next launch. Such a token is left for the person to
  // paste by hand; it never enters the queue.
  if (
    token.length > NUT_DROP_QUEUE_LIMITS.token ||
    classified.mintUrl.length > NUT_DROP_QUEUE_LIMITS.mintUrl ||
    unit.length > NUT_DROP_QUEUE_LIMITS.unit ||
    tokenHash.length > NUT_DROP_QUEUE_LIMITS.tokenHash ||
    !Number.isSafeInteger(classified.amount) ||
    classified.amount < 0
  ) {
    return 'unsupported';
  }

  const entry = {
    token,
    mintUrl: classified.mintUrl,
    amount: classified.amount,
    unit,
    source: 'nostr' as const,
    senderPubkey: dm.senderPubkey,
  };
  const trusted = await deps.isTrustedMint(entry.mintUrl);
  if (!deps.stillCurrent()) return 'abandoned';
  if (trusted === false) {
    // Parked without a single request to the mint: probing it would tell a
    // server the sender picked where this wallet is, and store its keysets.
    deps.queue.enqueue(tokenHash, entry);
    deps.queue.park(tokenHash);
    return 'needs-review';
  }
  if (trusted === null) {
    // The wallet is not up. Queue unprobed; the orchestrator applies the
    // trust gate when it runs.
    deps.queue.enqueue(tokenHash, entry);
    return 'queued';
  }
  const spent = await deps.isSpent(token);
  // The last await is behind us: check, then write, with nothing in between.
  if (!deps.stillCurrent()) return 'abandoned';
  if (spent === true) {
    // Enqueue-then-mark keeps the hash as a dedupe record without it ever
    // being a candidate for redemption.
    deps.queue.enqueue(tokenHash, entry);
    deps.queue.markSpent(tokenHash);
    return 'already-spent';
  }
  deps.queue.enqueue(tokenHash, entry);
  return 'queued';
}
