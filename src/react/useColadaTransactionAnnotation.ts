import { useEffect, useMemo, useState } from "react";

import {
  candidateKeys,
  decodeAnnotation,
  firstAnnotationRecord,
  type AnnotationEntryLike,
  type TransactionAnnotation,
} from "../annotations";
import { useAnnotationStore } from "./ColadaProvider";

/**
 * The decoded annotation for a single transaction entry (row + detail). Resolves
 * across the entry's candidate keys so a write under any earlier anchor is
 * found, and re-renders when the annotation store changes.
 */
export function useColadaTransactionAnnotation(
  entry: AnnotationEntryLike | null | undefined,
): TransactionAnnotation {
  const store = useAnnotationStore();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setVersion((v) => v + 1));
    return unsubscribe;
  }, [store]);

  return useMemo(() => {
    if (!entry) return {};
    const record = firstAnnotationRecord(store.getMany(candidateKeys(entry)));
    return record ? decodeAnnotation(record) : {};
    // version drives recompute when the store mutates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, entry?.id, entry?.quoteId, entry?.operationId]);
}
