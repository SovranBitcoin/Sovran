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

/**
 * True when the transaction is P2PK-locked. Resolves from the annotation today;
 * Slice E adds a proof-secret fallback for un-annotated historical rows.
 */
export function isP2PKLocked(entry: EntryWithMetadata): boolean {
  return getAnnotation(entry).lock?.type === "p2pk";
}
