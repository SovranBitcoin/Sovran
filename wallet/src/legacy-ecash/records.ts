import { z } from "zod";

/**
 * What became of each group of old proofs. Amounts are tallies in the
 * keyset's unit, kept so support can say what happened; they are never spent
 * from, so a tally that cannot be read falls back to zero.
 */

/** Why the last attempt on a group did not finish it. */
const LEGACY_CLAIM_ERROR_CLASSES = [
  /** No answer, a timeout or a server error. Tried again later. */
  "transient",
  /** The mint is still working on these proofs. Tried again later. */
  "pending",
  /** A receive was sent and its result is not known yet. */
  "claim-in-flight",
  /** The mint took the proofs from someone else between the check and the claim. */
  "spent-during-claim",
  /** The mint no longer has the keyset that signed these proofs. */
  "keyset-unknown",
  /** The mint says the proofs are not valid. */
  "proofs-rejected",
  /** The wallet refused the proofs, for example because fees exceed them. */
  "wallet-refused",
] as const;
export type LegacyClaimErrorClass = (typeof LEGACY_CLAIM_ERROR_CLASSES)[number];

const LEGACY_GROUP_STATUSES = [
  /** Not finished. Looked at again on a later launch. */
  "open",
  /** Unspent proofs at a mint the wallet does not trust. Waits for the person. */
  "awaiting-trust",
  /** Every proof is in the wallet or spent. Never looked at again. */
  "settled",
  /** Gave up. The proofs stay in the old row. */
  "could-not-claim",
  /** The person declined to trust the mint. Reopens if they trust it later. */
  "left-unclaimed",
] as const;

const Tally = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0).catch(0);
const Count = z.number().int().nonnegative().max(1_000_000).default(0).catch(0);
/** A hash of a proof secret, so a settled proof is recognised without storing the secret. */
const ProofFingerprint = z.string().max(64);

export const LegacyGroupRecordSchema = z.object({
  mintUrl: z.string().max(512),
  keysetId: z.string().max(128),
  profileIndex: z.number().int().nonnegative(),
  /** The account this group is claimed into. */
  accountIndex: z.number().int().nonnegative(),
  unit: z.string().max(32).nullable().default(null).catch(null),
  // An unreadable status reopens the group: the mint is asked again, which is
  // safe, and nothing is treated as finished on a guess.
  status: z.enum(LEGACY_GROUP_STATUSES).default("open").catch("open"),
  /** Face value received through the wallet, before the mint's swap fee. */
  claimed: Tally,
  /** Face value the mint reported spent. */
  spent: Tally,
  /** Face value an earlier release had already imported into this wallet. */
  inWallet: Tally,
  /** Face value given up on. */
  failed: Tally,
  /** Face value known unspent and not yet claimed. */
  awaiting: Tally,
  /**
   * Whether the proofs were compared with account 0's wallet. Releases 0.0.45
   * to 0.0.56 imported every old profile into that one wallet, so a group is
   * claimed nowhere while this is `pending`. `no-first-account` records that
   * the phone had no account 0, and so no such wallet, when the claim ran.
   */
  firstAccountComparison: z
    .enum(["pending", "compared", "no-first-account"])
    .default("pending")
    .catch("pending"),
  /** Proofs that are finished with: claimed, spent or already in the wallet. */
  done: z.array(ProofFingerprint).max(20_000).default([]).catch([]),
  attempts: Count,
  nextAttemptAt: z.number().int().nonnegative().default(0).catch(0),
  lastError: z.enum(LEGACY_CLAIM_ERROR_CLASSES).nullable().default(null).catch(null),
  /** Written before the receive is sent, so a kill in between is settled from the wallet's own record. */
  claiming: z
    .object({
      operationId: z.string().max(128),
      accountIndex: z.number().int().nonnegative(),
      proofs: z.array(ProofFingerprint).max(1_000),
      amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .nullable()
    .default(null)
    .catch(null),
  updatedAt: z.number().int().nonnegative().default(0).catch(0),
});
export type LegacyGroupRecord = z.infer<typeof LegacyGroupRecordSchema>;

const LEGACY_QUOTE_STATUSES = [
  "open",
  /** Never paid, already minted, or the mint has no such quote. */
  "nothing-to-claim",
  /** The mint holds a paid invoice whose ecash was never minted. */
  "paid-unclaimed",
  /** The mint never gave an answer that settles it. Keeps the old row. */
  "unresolved",
] as const;

export const LegacyQuoteRecordSchema = z.object({
  mintUrl: z.string().max(512),
  amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  unit: z.string().max(32),
  status: z.enum(LEGACY_QUOTE_STATUSES).default("open").catch("open"),
  attempts: Count,
  nextAttemptAt: z.number().int().nonnegative().default(0).catch(0),
});
export type LegacyQuoteRecord = z.infer<typeof LegacyQuoteRecordSchema>;

export interface LegacyEcashRecords {
  groups: Record<string, LegacyGroupRecord>;
  /** Keyed by a hash of the mint URL and quote id; the id itself stays in the old row. */
  quotes: Record<string, LegacyQuoteRecord>;
}
