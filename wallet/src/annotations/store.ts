// ---------------------------------------------------------------------------
// Annotation store adapter (framework-agnostic)
// ---------------------------------------------------------------------------
//
// colada owns the annotation model + keying + selectors, but NOT persistence:
// that is the consuming wallet's concern (sovran-app backs it with a
// profile-scoped MMKV store). The wallet supplies an `AnnotationStoreAdapter`;
// colada reads/writes through it. Reads are synchronous because the transaction
// list merges annotations per-row on the render path.
//
// A default in-memory adapter ships so unit tests and non-persistent consumers
// work with zero configuration.

import type { AnnotationRecord } from "./model";

export interface AnnotationStoreAdapter {
  /** Snapshot read of one record (sync — render path). */
  get(key: string): AnnotationRecord | undefined;
  /** Bulk snapshot read for a candidate-key set. */
  getMany(keys: readonly string[]): Array<AnnotationRecord | undefined>;
  /**
   * Merge-patch a record. The patch is additive at the field level: keys it
   * doesn't mention are preserved. First-write-wins policy (e.g. distribution)
   * is enforced one layer up, not here.
   */
  set(key: string, patch: AnnotationRecord): void;
  has(key: string): boolean;
  /** Change subscription. Returns an unsubscribe. Fires on any key change. */
  subscribe(listener: () => void): () => void;
}

/** Default in-memory adapter. Field-level additive merge; no persistence. */
export function createInMemoryAnnotationStore(): AnnotationStoreAdapter {
  const map = new Map<string, AnnotationRecord>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    get: (key) => map.get(key),
    getMany: (keys) => keys.map((key) => map.get(key)),
    set: (key, patch) => {
      if (Object.keys(patch).length === 0) return;
      const existing = map.get(key);
      map.set(key, { ...(existing ?? {}), ...patch });
      emit();
    },
    has: (key) => map.has(key),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** First non-undefined record from a candidate-key lookup. */
export function firstAnnotationRecord(
  records: ReadonlyArray<AnnotationRecord | undefined>,
): AnnotationRecord | undefined {
  for (const record of records) {
    if (record && Object.keys(record).length > 0) return record;
  }
  return undefined;
}

/**
 * Merge every candidate-key record into one. An entry's annotations can be
 * split across keys — e.g. distribution written under `quote:` while a migrated
 * location sits under `id:`, or a scan bridged from a `raw:` key. `records` is
 * candidate-key order (most-canonical first); the more canonical key wins on
 * conflict. Returns undefined when nothing is present.
 */
export function mergeAnnotationRecords(
  records: ReadonlyArray<AnnotationRecord | undefined>,
): AnnotationRecord | undefined {
  let merged: AnnotationRecord | undefined;
  // Apply least-canonical first so the most-canonical record overwrites.
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record && Object.keys(record).length > 0) {
      merged = { ...(merged ?? {}), ...record };
    }
  }
  return merged;
}
