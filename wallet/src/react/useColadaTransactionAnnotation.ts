import { useEffect, useMemo, useState } from "react";

import {
  candidateKeys,
  decodeAnnotation,
  mergeAnnotationRecords,
  type AnnotationEntryLike,
  type TransactionAnnotation,
} from "../annotations";
import { useAnnotationStore } from "./ColadaProvider";

/** Joins the candidate keys into one comparable cache key. */
const KEY_SEPARATOR = "\u0000";

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

  // Recompute when the CONTENT of the candidate key set changes, not when
  // `entry`'s identity does and not on a hand-picked subset of its fields. The
  // old dep list named `entry?.id`/`quoteId`/`operationId` behind an
  // exhaustive-deps suppression, which was narrower than what `candidateKeys`
  // actually reads — it also reads `type` and `metadata.operationId` — so an
  // entry that gained either kept serving the annotation resolved before it.
  // A suppression of a react-hooks rule also switches the React Compiler off
  // for the whole hook, so the honest list buys both back.
  //
  // `cacheKey` is only ever a cache key: the lookup re-derives the array from
  // `entry` rather than splitting the joined string, so an id that happened to
  // contain the separator could never fan out into another transaction's keys.
  const cacheKey = entry ? candidateKeys(entry).join(KEY_SEPARATOR) : "";

  return useMemo(() => {
    if (!entry) return {};
    const record = mergeAnnotationRecords(store.getMany(candidateKeys(entry)));
    return record ? decodeAnnotation(record) : {};
  }, [store, version, cacheKey, entry]);
}
