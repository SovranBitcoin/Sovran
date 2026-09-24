// ---------------------------------------------------------------------------
// Annotation selectors (framework-agnostic)
// ---------------------------------------------------------------------------
//
// Typed reads over an entry whose annotation record has already been merged
// into `metadata` (see `mergeAnnotationsIntoEntry`). The app never hand-parses
// flat keys — it calls these.

import {
  describeRecordedLock,
  describeSpendingConditions,
  proofsHaveP2PK,
  type SpendingConditions,
} from "../p2pk";
import {
  decodeAnnotation,
  type AnnotationRecord,
  type TransactionAnnotation,
} from "./model";

type EntryWithMetadata = { metadata?: Record<string, string> | undefined };

function entryRecord(entry: EntryWithMetadata): AnnotationRecord {
  return entry.metadata ?? {};
}

/** Decode the full annotation off a merged entry. */
export function getAnnotation(entry: EntryWithMetadata): TransactionAnnotation {
  return decodeAnnotation(entryRecord(entry));
}

export function getCounterparty(
  entry: EntryWithMetadata,
): TransactionAnnotation["counterparty"] | null {
  return getAnnotation(entry).counterparty ?? null;
}

export function getScanSource(
  entry: EntryWithMetadata,
): TransactionAnnotation["scan"] | null {
  return getAnnotation(entry).scan ?? null;
}

export function getDistribution(
  entry: EntryWithMetadata,
): TransactionAnnotation["distribution"] | null {
  return getAnnotation(entry).distribution ?? null;
}

export function getLocation(
  entry: EntryWithMetadata,
): TransactionAnnotation["location"] | null {
  return getAnnotation(entry).location ?? null;
}

export function getSwap(
  entry: EntryWithMetadata,
): TransactionAnnotation["swap"] | null {
  return getAnnotation(entry).swap ?? null;
}

export function getPaymentRequest(
  entry: EntryWithMetadata,
): TransactionAnnotation["paymentRequest"] | null {
  return getAnnotation(entry).paymentRequest ?? null;
}

export function getOnchainMelt(
  entry: EntryWithMetadata,
): TransactionAnnotation["onchainMelt"] | null {
  return getAnnotation(entry).onchainMelt ?? null;
}

export function getZap(
  entry: EntryWithMetadata,
): TransactionAnnotation["zap"] | null {
  return getAnnotation(entry).zap ?? null;
}

type EntryWithToken = EntryWithMetadata & { token?: unknown };

const hasSecret = (proof: unknown): proof is { secret: string } =>
  typeof proof === "object" &&
  proof !== null &&
  "secret" in proof &&
  typeof proof.secret === "string";

const proofsOf = (holder: unknown): Array<{ secret: string }> =>
  typeof holder === "object" &&
  holder !== null &&
  "proofs" in holder &&
  Array.isArray(holder.proofs)
    ? holder.proofs.filter(hasSecret)
    : [];

/** Best-effort proof extraction from a (send) history entry's token. */
function entryProofs(entry: EntryWithToken): Array<{ secret: string }> {
  const token = entry.token;
  if (typeof token !== "object" || token === null) return [];
  if ("proofs" in token && Array.isArray(token.proofs)) return proofsOf(token);
  // Legacy v3 token: { token: [{ proofs: [...] }] }
  if ("token" in token && Array.isArray(token.token)) {
    return token.token.flatMap(proofsOf);
  }
  return [];
}

/**
 * True when the transaction is P2PK-locked. Resolves from the annotation (set
 * for outgoing locks and Nut Drop receives), falling back to inspecting the
 * entry's token proof secrets for un-annotated rows (e.g. historical sends).
 */
export function isP2PKLocked(entry: EntryWithToken): boolean {
  if (getAnnotation(entry).lock?.type === "p2pk") return true;
  return proofsHaveP2PK(entryProofs(entry));
}

/**
 * What this transaction's ecash can and cannot do — read from the token's own
 * proofs while it still has them, and from what we recorded at send time once
 * it does not.
 *
 * Proofs win: they are the thing the mint will actually judge. The record is
 * the memory of it, and only the record survives the hand-over.
 */
export function describeSendLock(
  entry: EntryWithToken,
  opts: {
    now: number;
    /** Public keys this wallet can sign for; omit when unknown. */
    ourPubkeys?: readonly string[];
    skewMs?: number;
  },
): SpendingConditions | null {
  const proofs = entryProofs(entry);
  if (proofs.length > 0) {
    const fromProofs = describeSpendingConditions({ proofs, ...opts });
    if (fromProofs.kind !== "unlocked") return fromProofs;
  }
  const lock = getAnnotation(entry).lock;
  if (!lock || lock.type !== "p2pk") {
    return proofs.length > 0
      ? describeSpendingConditions({ proofs, ...opts })
      : null;
  }
  return describeRecordedLock({ lock, ...opts });
}
