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
  PaymentRequestRole,
  PaymentRequestAnnotationTransport,
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
  firstAnnotationRecord,
  mergeAnnotationRecords,
} from "./store";
export type { AnnotationStoreAdapter } from "./store";

export {
  getAnnotation,
  getCounterparty,
  getScanSource,
  getDistribution,
  getLocation,
  getSwap,
  getPaymentRequest,
  getOnchainMelt,
  getZap,
  isP2PKLocked,
} from "./selectors";
