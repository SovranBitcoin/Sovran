import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  candidateKeys,
  decodeAnnotation,
  mergeAnnotationRecords,
  type AnnotationEntryLike,
  type AnnotationRecord,
  type TransactionAnnotation,
} from "../annotations";
import { useAnnotationStore } from "./ColadaProvider";

/** The one empty annotation, so a miss is referentially stable across renders. */
const EMPTY_ANNOTATION: TransactionAnnotation = Object.freeze({});

function sameRecords(
  a: ReadonlyArray<AnnotationRecord | undefined>,
  b: ReadonlyArray<AnnotationRecord | undefined>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The decoded annotation for a single transaction entry (row + detail). Resolves
 * across the entry's candidate keys so a write under any earlier anchor is
 * found, and re-renders when the annotation store changes.
 *
 * Reads go through `useSyncExternalStore`, so every store emit re-runs the
 * snapshot read. The earlier shape — a `version` counter bumped from a
 * subscription plus a `useMemo` that listed `version` as a dependency but never
 * read it — stopped re-reading once the React Compiler took over the memo: the
 * compiler tracks the values a memo body actually reads, and the body read only
 * `store` and `entry`, so a toggle that wrote to the store left the screen
 * showing the annotation resolved at mount (the payment-request P2PK and mint
 * switches "needed a close and reopen").
 */
export function useColadaTransactionAnnotation(
  entry: AnnotationEntryLike | null | undefined,
): TransactionAnnotation {
  const store = useAnnotationStore();

  // The snapshot closes over the whole entry, not a hand-picked subset of its
  // fields: `candidateKeys` reads `type` and `metadata.operationId` as well as
  // the ids, so an entry that gains either must resolve again.
  const getSnapshot = useMemo(() => {
    if (!entry) return () => EMPTY_ANNOTATION;
    const keys = candidateKeys(entry);
    // `useSyncExternalStore` needs the snapshot to be referentially stable
    // while the underlying records are unchanged, or it re-renders forever.
    let last:
      | {
          records: Array<AnnotationRecord | undefined>;
          value: TransactionAnnotation;
        }
      | undefined;
    return () => {
      const records = store.getMany(keys);
      if (last && sameRecords(last.records, records)) return last.value;
      const record = mergeAnnotationRecords(records);
      last = {
        records,
        value: record ? decodeAnnotation(record) : EMPTY_ANNOTATION,
      };
      return last.value;
    };
  }, [store, entry]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
