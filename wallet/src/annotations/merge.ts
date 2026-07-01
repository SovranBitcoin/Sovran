// ---------------------------------------------------------------------------
// Merge annotations into a read-model entry (framework-agnostic)
// ---------------------------------------------------------------------------

import type { AnnotationRecord } from "./model";

/** Minimal entry shape: anything carrying a string metadata map. */
type EntryWithMetadata = { metadata?: Record<string, string> | undefined };

/**
 * Merge a flat annotation record into an entry's `metadata`. coco's own
 * metadata wins on key conflict (it is canonical for receives); annotations
 * only add/fill keys coco didn't populate.
 *
 * Returns the SAME reference when there is nothing to merge — load-bearing for
 * the read-model's `sameTransactionList` reference-stability gate, so
 * un-annotated rows keep their identity and don't force a re-render.
 */
export function mergeAnnotationsIntoEntry<E extends EntryWithMetadata>(
  entry: E,
  record: AnnotationRecord | undefined,
): E {
  if (!record || Object.keys(record).length === 0) return entry;
  return {
    ...entry,
    metadata: { ...record, ...(entry.metadata ?? {}) },
  };
}
