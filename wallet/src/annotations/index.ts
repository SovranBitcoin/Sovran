// ---------------------------------------------------------------------------
// colada/annotations — public surface
// ---------------------------------------------------------------------------

export { encodeAnnotation, decodeAnnotation } from "./model";
export type {
  AnnotationRecord,
  TransactionAnnotation,
  ScanMethod,
  DistributionSource,
  ZapReceiptKind,
} from "./model";

export {
  annotationKey,
  candidateKeys,
  rawAnnotationKey,
  normaliseAnnotationRaw,
} from "./key";
export type { AnnotationEntryLike } from "./key";

export { mergeAnnotationsIntoEntry } from "./merge";

export {
  createInMemoryAnnotationStore,
  mergeAnnotationRecords,
} from "./store";
export type { AnnotationStoreAdapter } from "./store";

export {
  getCounterparty,
  getScanSource,
  getSwap,
  getPaymentRequest,
  getZap,
  describeSendLock,
  isP2PKLocked,
} from "./selectors";
