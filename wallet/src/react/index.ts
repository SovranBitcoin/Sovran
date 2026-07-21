// ---------------------------------------------------------------------------
// colada/react — React hooks & provider
// ---------------------------------------------------------------------------

// Provider & flow hooks
export {
  ColadaProvider,
  useAnnotationStore,
  useColadaContext,
  useColadaManager,
  useColadaSubscriptions,
  useColadaTrustedMintUrls,
  usePaymentCopy,
  usePaymentFlowMachine,
  useSetTransactionAnnotation,
  type DeepLinkConfig,
  type ColadaProviderProps,
  type PaymentFlowRefs,
  type ScreenActionsBridge,
  type SetTransactionAnnotation,
} from "./ColadaProvider";

// Transaction list read model
export {
  useColadaTransactions,
  type UseColadaTransactionsResult,
} from "./useColadaTransactions";

// Single-entry annotation read model
export { useColadaTransactionAnnotation } from "./useColadaTransactionAnnotation";

// Balance breakdown read model
export { useColadaBalance } from "./useColadaBalance";

export {
  useReusableMintQuote,
  type UseReusableMintQuoteResult,
} from "./useReusableMintQuote";
export {
  useStandingPaymentRequest,
  type UseStandingPaymentRequestResult,
} from "./useStandingPaymentRequest";

export type {
  BleAdapter,
  CameraAdapter,
  ChainAdapter,
  ClipboardAdapter,
  ClockAdapter,
  ColadaAdapters,
  HapticsAdapter,
  ImagePickerAdapter,
  NfcAdapter,
  NostrAdapter,
  NotificationsAdapter,
  QrDecoderAdapter,
  QrEncoderAdapter,
  RandomAdapter,
  SecureStorageAdapter,
  ShareAdapter,
  StorageAdapter,
} from "../adapters";

export type {
  ColadaSubscriptionBus,
  ColadaSubscriptionEvent,
  HistoryEntryType,
  SubscriptionEventType,
  SubscriptionFilter,
  SubscriptionListener,
} from "../subscriptions";

export type {
  PaymentCopyKey,
  PaymentCopyResolver,
  PaymentCopyVariables,
} from "../copy";

// Scan types (machine.scan uses these)
export type {
  URDecoderLike,
  ScanOptions,
  ProcessResult,
  ScanSourceResult,
  ScanSources,
} from "../machine/types";

// Post-terminal screen actions
export {
  useScreenActions,
  useScreenActionsWithConfig,
  type BoundAction,
  type UseScreenActionsConfig,
  type UseScreenActionsResult,
} from "./useScreenActions";

// Re-export suggestion types for convenience
export type {
  QuickSendSuggestion,
  QuickSendConfig,
} from "../amount-actions/types";

// Low-level machine hook (for wallets not using ColadaProvider)
export {
  usePaymentMachine,
  type UsePaymentMachineConfig,
} from "./usePaymentMachine";

// Execution state subscription
export { useExecutionState } from "./useExecutionState";
