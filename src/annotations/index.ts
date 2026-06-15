// ---------------------------------------------------------------------------
// colada/annotations — public surface
// ---------------------------------------------------------------------------

export { ANNOTATION_KEYS, encodeAnnotation, decodeAnnotation } from "./model";
export type {
  AnnotationRecord,
  TransactionAnnotation,
  CounterpartyDirection,
  ScanMethod,
  LockDirection,
  DistributionSource,
  SwapRole,
} from "./model";

export {
  annotationKey,
  candidateKeys,
  rawAnnotationKey,
  normaliseAnnotationRaw,
} from "./key";
export type { AnnotationEntryLike } from "./key";

export { mergeAnnotationsIntoEntry } from "./merge";

export { createInMemoryAnnotationStore, firstAnnotationRecord } from "./store";
export type { AnnotationStoreAdapter } from "./store";

export {
  getAnnotation,
  getCounterparty,
  getScanSource,
  getDistribution,
  getLocation,
  getSwap,
  isP2PKLocked,
} from "./selectors";
