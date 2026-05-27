// ---------------------------------------------------------------------------
// colada — public API
// ---------------------------------------------------------------------------

// Core factory (framework-agnostic entry point)
export {
  createColada,
  createMachineFromInstance,
  createWalletContextTracker,
  type ColadaConfig,
  type ColadaInstance,
  type CreateMachineFromInstanceConfig,
  type WalletContextTracker,
} from './core';

// Re-export Manager type so consumers don't need to import coco-cashu-core
export type { Manager } from '@cashu/coco-core';

// Logger seam — consumers inject a structured logger via the `logger` option
// on `createColada`; tests and standalone consumers get a no-op default.
export { setLogger, type CocoLogger } from './logger';

// Adapter contracts
export type {
  BleAdapter,
  CameraAdapter,
  ChainAdapter,
  ChainFeeEstimate,
  ChainNetwork,
  ChainTransactionStatus,
  ClipboardAdapter,
  ClockAdapter,
  ColadaAdapters,
  HapticsAdapter,
  ImagePickerAdapter,
  JsonPrimitive,
  JsonRecord,
  JsonValue,
  LoggerAdapter,
  NfcAdapter,
  NostrAdapter,
  NotificationsAdapter,
  QrDecoderAdapter,
  QrEncoderAdapter,
  RandomAdapter,
  SecureStorageAdapter,
  ShareAdapter,
  StorageAdapter,
} from './adapters';

// Subscription bus
export { createSubscriptionBus, matchesSubscriptionFilter } from './subscriptions';
export type {
  ColadaSubscriptionBus,
  ColadaSubscriptionEvent,
  HistoryEntryType,
  HistoryUpdatedEvent,
  MeltUpdatedEvent,
  MintInfoEnrichmentChangedEvent,
  MintInfoFetchedEvent,
  MintSelectorItemAddedEvent,
  MintUpdatedEvent,
  ReceiveNpcMintChangedEvent,
  ReceiveP2pkKeyChangedEvent,
  ScreenActionsChangedEvent,
  ScreenActionsChangedReason,
  SubscriptionEventForFilter,
  SubscriptionEventForType,
  SubscriptionEventType,
  SubscriptionFilter,
  SubscriptionListener,
} from './subscriptions';

// Machine (state machine core)
export { createPaymentMachine } from './machine/createMachine';
export { resolveNext } from './machine/resolveNext';

// Pipeline utilities (usable standalone)
export { parsePaymentInput, isBip321 } from './parse';
export {
  buildBip321OnchainUri,
  formatSatsAsBtcAmount,
  type BuildBip321OnchainUriOptions,
} from './bip321';
export { resolveIntent } from './intent';
export { defaultDetectors } from './detectors';
export { annotateOptions } from './annotate';
export { selectMint, selectMintForMelt, type MintSelectionConfig } from './mint-selection';
export {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveMintMethodSupportFromInfo,
  evaluateMintMethodAmountAvailability,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
  hasCompatibleMintForMethod,
  hasMintSupportingMethod,
  isMethodImplemented,
  isMintMethodCompatible,
  methodContextHasCompatibleMint,
  methodContextHasSupportingMint,
  type MintMethodAmountAvailability,
} from './mint-capabilities';
export {
  validateIntent,
  checkWalletCapabilities,
  checkAllCapabilities,
  isValidSatAmount,
  MAX_SAT_AMOUNT,
} from './guards';
export { getNfcFallback, getAllFallbacks } from './nfc-fallback';

// Normalization
export {
  sanitizeInput,
  safeDecodeURIComponent,
  stripPrefixes,
  stripGenericPrefixes,
  stripLightningPrefixes,
  stripCashuPrefixes,
  inputVariants,
} from './normalize';

// Proof composition primitives
export {
  buildExactOfflineAmountIndex,
  composeSatoshis,
  composeFiat,
  getRoundedFiatMinorUnitForSats,
  getSatRangeForDisplayedFiatMinorUnit,
} from './offline';

// Machine types
export type {
  FlowStep,
  FlowContext,
  FlowEvent,
  Destination,
  StepDataMap,
  StepHandlerMap,
  CreateMachineConfig,
  MachineOperations,
  PaymentMachine,
  ExecutionState,
  ErrorCode,
  MachineSnapshot,
  MeltQuoteMethod,
  MintQuoteMethod,
  NotificationHandlerMap,
  PaymentQuoteMethod,
  ScanSourceResult,
  ScanSources,
  NfcIOAdapter,
  RecipientProfile,
} from './machine/types';

export type { MintAvailability } from './machine/selectMintContext';

// Amount actions (amount screen action system)
export {
  createAmountActionManager,
  resolveAmount,
  resolutionEqual,
  computeQuickSendSuggestions,
} from './amount-actions';
export type {
  AmountInputMode,
  CoreAmountResolution,
  AmountResolution,
  CreateAmountActionManagerConfig,
  AmountActionManager,
  QuickSendSuggestion,
  QuickSendConfig,
} from './amount-actions';

// Screen actions (post-terminal screen action system)
export {
  createScreenActionManager,
  getAvailableActions,
  isPaymentRequestPreview,
  shouldApplyEntryUpdate,
  mergeEntryUpdate,
  decorateEntry,
  meltOperationToScreenActionEntry,
  createDefaultScreenActionHandlers,
} from './screen-actions';
export type {
  ActionAvailability,
  ActionHandler,
  ActionState,
  ActionVariant,
  DecoratedEntryFields,
  DefaultScreenActionHandlersConfig,
  MeltOperationLike,
  NavigationCallbacks,
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenType,
} from './screen-actions';

// Formatting utilities
export { FormattedTimestamp } from './formatting';
export { FormattedString, type TruncateMode } from './formatting';
export { localizeReason, type LocalizedReason } from './formatting';

// LNURL resolution (lightning address & lnurlp → bolt11)
export {
  requestInvoiceFromLnurl,
  getLnurlPayParams,
  parseLightningAddress,
  parseLnurlp,
  decodeUrlOrAddress,
  isLightningInvoiceBolt11,
  LnurlError,
  type LnurlErrorCode,
} from './lnurl';

// Recipient identity resolution (Lightning Address → Nostr hex pubkey)
export { fetchNip05Pubkey } from './nip05';
export { resolveRecipientPubkey } from './recipient';

// Cancellable-fetch primitives (timeout + AbortSignal). Hermes lacks
// `DOMException`, so callers must duck-type aborts via `isAbortError`
// rather than `instanceof DOMException`. The same primitives back the
// app's `apiClient` so there's one canonical implementation.
export {
  combineSignals,
  isAbortError,
  safeFetch,
  timeoutSignal,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
  type RequestControls,
} from './safeFetch';

// Domain types
export type {
  Detectors,
  PaymentRequestInfo,
  PaymentRequestTransport,
  WalletContext,
  AmountEntryMethodContext,
  MintMethodCapabilityMap,
  MintMethodRequirement,
  MintMethodSupport,
  MintMethodUnitCapability,
  MintPaymentMethod,
  MintPaymentOperation,
  PaymentOptionKind,
  PaymentOption,
  Bip321Container,
  ParsedInputType,
  ParsedPaymentInput,
  OptionStatus,
  AnnotatedOption,
  RecommendationRule,
  ResolvedIntent,
  AmountEntryConstraints,
  MintListItem,
  MintCatalogEntry,
  MintSelectionResult,
  MintCandidate,
  MintReviewInfo,
  GuardResult,
  WalletCapability,
  CapabilityCheckResult,
  ExactOfflineAmountIndex,
  FiatMinorUnitSatRange,
  CompositionResult,
  FiatCompositionResult,
} from './types';
