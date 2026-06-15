// ---------------------------------------------------------------------------
// Annotation selectors (framework-agnostic)
// ---------------------------------------------------------------------------
//
// Typed reads over an entry whose annotation record has already been merged
// into `metadata` (see `mergeAnnotationsIntoEntry`). The app never hand-parses
// flat keys — it calls these.

import {
  decodeAnnotation,
  type AnnotationRecord,
  type TransactionAnnotation,
} from "./model";

type EntryWithMetadata = { metadata?: Record<string, string> | undefined };

function entryRecord(entry: EntryWithMetadata): AnnotationRecord {
  return (entry.metadata ?? {}) as AnnotationRecord;
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

type EntryWithToken = EntryWithMetadata & { token?: unknown };

/** Best-effort proof extraction from a (send) history entry's token. */
function entryProofs(entry: EntryWithToken): Array<{ secret: string }> {
  const token = entry.token as
    | { proofs?: unknown; token?: unknown }
    | undefined;
  if (!token) return [];
  if (Array.isArray(token.proofs))
    return token.proofs as Array<{ secret: string }>;
  // Legacy v3 token: { token: [{ proofs: [...] }] }
  if (Array.isArray(token.token)) {
    return (token.token as Array<{ proofs?: unknown }>).flatMap((t) =>
      Array.isArray(t?.proofs) ? (t.proofs as Array<{ secret: string }>) : [],
    );
  }
  return [];
}

function proofsHaveP2PK(proofs: ReadonlyArray<{ secret: string }>): boolean {
  return proofs.some((proof) => {
    try {
      const parsed = JSON.parse(proof.secret);
      return Array.isArray(parsed) && parsed[0] === "P2PK";
    } catch {
      return false;
    }
  });
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
