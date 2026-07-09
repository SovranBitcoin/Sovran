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
} from "./core";

// Re-export Manager type so consumers don't need to import coco-cashu-core
export type { Manager } from "@cashu/coco-core";

// Wallet seed helpers
export {
  CashuSeedError,
  createCashuSeedGetter,
  deriveStandardCashuSeed,
  generateCashuMnemonic,
  isValidCashuMnemonic,
  normalizeCashuMnemonic,
  tryDeriveStandardCashuSeed,
} from "./wallet-seed";
export type {
  CashuSeedCache,
  CashuSeedCacheContext,
  CashuSeedErrorCode,
  CashuSeedResult,
  CreateCashuSeedGetterConfig,
  DeriveStandardCashuSeedOptions,
  GenerateCashuMnemonicOptions,
} from "./wallet-seed";

// Logger seam — consumers inject a structured logger via the `logger` option
// on `createColada`; tests and standalone consumers get a no-op default.
export { setLogger, type CocoLogger } from "./logger";

// Copy / i18n
export {
  DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
  addressExplorerUrl,
  buildOnchainConfirmationProgressFromTx,
  createMempoolSpaceChainAdapter,
  defaultChainAdapter,
  fetchMempoolAddressStats,
  getOnchainConfirmationInfo,
  getOnchainConfirmationProgress,
  MempoolAddressStatsSchema,
  MempoolHttpError,
  parseOutpoint,
  shouldStopTxConfirmationPolling,
  summarizeMempoolAddress,
  transactionExplorerUrlForTxid,
} from "./chain";
export type {
  MempoolAddressSummary,
  MempoolAddressStats,
  MempoolSpaceChainAdapterOptions,
  OnchainConfirmationProgress as ChainOnchainConfirmationProgress,
} from "./chain";

export {
  createPaymentCopyGroups,
  createPaymentCopyResolver,
  getPaymentCopy,
  MELT_COPY,
  MINT_COPY,
  PAYMENT_REQUEST_COPY,
  paymentCopyDefaults,
  RECEIVE_COPY,
  registerPaymentCopyLocale,
  resolvePaymentCopy,
  SEND_COPY,
  TOAST_COPY,
} from "./copy";
export type {
  PaymentCopyCatalog,
  PaymentCopyError,
  PaymentCopyKey,
  PaymentCopyOptions,
  PaymentCopyResolver,
  PaymentCopyResult,
  PaymentCopyVariables,
} from "./copy";

// History / payment-state timeline
export {
  buildTimeline,
  bucketTransaction,
  getCardLabel,
  getHistoryEntryRefreshLabel,
  getSendTokenReachabilityWarning,
  getHistoryEntryOnchainMeltAddress,
  getHistoryEntryOnchainMintAddress,
  getStatusColorType,
  getStatusHeader,
  groupTimeline,
  inFlightReceiveToHistoryEntry,
  isPendingPaymentRequestEntry,
  listInFlightReceiveEntries,
  listPendingPaymentRequestEntries,
  mergeTransactionSources,
  pendingPaymentRequestToHistoryEntry,
  sameTransactionList,
  normalizeHistoryEntry,
  serializeHistoryEntry,
  isCancellablePendingEcash,
  isMeltQuotePaid,
  isMeltQuoteReadyToPay,
  isMintExpired,
  isMintQuotePaymentObserved,
  isOnchainHistoryEntry,
  isPendingTransaction,
  isReceiveTokenPending,
  isReceiveTokenRedeemed,
  isReservedSendHistoryEntry,
  isSendTokenCancelled,
  isSendTokenComplete,
  isSettledReceiveHistoryEntry,
  isSettledSpendHistoryEntry,
  matchesTransactionDirection,
  matchesTransactionFilters,
  matchesTransactionPaymentType,
  shouldShowMintOfflineWarning,
} from "./history";
export type {
  BuildTimelineInput,
  ColadaTimelineItem,
  OnchainConfirmationProgress,
  SendTokenReachabilityStatus,
  SendTokenReachabilityWarningOptions,
  SendTokenWarningCopy,
  SwapTimelineState,
  TimelineItem,
  TimelineStepType,
  TransactionBucket,
  TransactionDirection,
  TransactionPaymentType,
} from "./history";

export { meltMethodForTarget } from "./melt-target";

// Transaction annotations (per-transaction side-data: counterparty, scan
// source, P2PK lock, distribution, location, swap grouping). colada owns the
// model + keying + selectors; the consuming wallet supplies persistence.
export {
  ANNOTATION_KEYS,
  annotationKey,
  candidateKeys,
  createInMemoryAnnotationStore,
  decodeAnnotation,
  encodeAnnotation,
  firstAnnotationRecord,
  getAnnotation,
  getCounterparty,
  getDistribution,
  getLocation,
  getOnchainMelt,
  getScanSource,
  getSwap,
  isP2PKLocked,
  mergeAnnotationRecords,
  mergeAnnotationsIntoEntry,
  normaliseAnnotationRaw,
  rawAnnotationKey,
} from "./annotations";
export type {
  AnnotationEntryLike,
  AnnotationRecord,
  AnnotationStoreAdapter,
  CounterpartyDirection,
  DistributionSource,
  LockDirection,
  ScanMethod,
  SwapRole,
  TransactionAnnotation,
} from "./annotations";

// Balance breakdown read model (framework-agnostic)
export {
  amountToNumber,
  emptyBalanceBreakdown,
  sumAmounts,
  sumReservedSends,
} from "./balance";
export type { WalletBalanceBreakdown } from "./balance";

// Adapter contracts
export type {
  BleAdapter,
  CameraAdapter,
  ChainAddressCounter,
  ChainAddressFundingTx,
  ChainAddressStats,
  ChainAddressSummary,
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
} from "./adapters";

// Subscription bus
export {
  createSubscriptionBus,
  matchesSubscriptionFilter,
} from "./subscriptions";
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
} from "./subscriptions";

// Errors
export {
  isMeltUserCancelledError,
  MeltUserCancelledError,
  isUnitRateUnavailableError,
  UnitRateUnavailableError,
} from "./errors";

// Reusable mint-quote singleton (standing bolt12 offer / onchain address)
export {
  ensureStandingPaymentRequest,
  reencodeSingleUsePaymentRequest,
  rotateStandingPaymentRequest,
  standingPaymentRequestKey,
  type SingleUseReencodeOptions,
  type StandingPaymentRequest,
  type StandingPaymentRequestInput,
} from "./payment-request-receive";
export {
  ensureReusableMintQuote,
  rotateReusableMintQuote,
  reusableQuoteKey,
  type EnsureReusableMintQuoteInput,
  type ReusableQuoteIdentityStore,
} from "./quotes/reusable";

// Machine (state machine core)
export { createPaymentMachine } from "./machine/createMachine";
export { resolveNext } from "./machine/resolveNext";

// Pipeline utilities (usable standalone)
export { parsePaymentInput, isBip321 } from "./parse";
export {
  buildBip321OnchainUri,
  buildUnifiedBip321Uri,
  formatSatsAsBtcAmount,
  type BuildBip321OnchainUriOptions,
  type BuildUnifiedBip321UriInput,
} from "./bip321";
export { resolveIntent } from "./intent";
export {
  describeDestination,
  type DescribeDestinationOptions,
} from "./destination-descriptor";
export {
  decodeEcashTokenMetadata,
  isValidEcashToken,
  type EcashTokenMetadata,
} from "./ecash";
export {
  decodePaymentRequestInfo,
  lockableMintsFromRequest,
} from "./payment-request";
export { decodeBolt11Invoice, type Bolt11Info } from "./bolt11";
export { defaultDetectors } from "./detectors";
export { annotateOptions } from "./annotate";
export {
  selectMint,
  selectMintForMelt,
  type MintSelectionConfig,
} from "./mint-selection";
export {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveMintMethodSupportFromInfo,
  deriveSupportedUnitsFromInfo,
  SWITCHABLE_UNITS,
  type SwitchableUnit,
  evaluateMintMethodAmountAvailability,
  getCapabilityUnavailableReason,
  getUnitAmountEnvelope,
  type AmountEntryEnvelope,
  getMintMethodCapability,
  hasCompatibleMintForMethod,
  hasMintSupportingMethod,
  isMethodImplemented,
  isMintMethodCompatible,
  methodContextHasCompatibleMint,
  methodContextHasSupportingMint,
  pickHighestBalanceUnit,
  pickMintForUnit,
  resolveReceiveMethodMint,
  type MintMethodAmountAvailability,
  type ReceiveMethodMintResolution,
} from "./mint-capabilities";
export {
  validateIntent,
  checkWalletCapabilities,
  checkAllCapabilities,
  isValidSatAmount,
  MAX_SAT_AMOUNT,
} from "./guards";
// Normalization
export {
  sanitizeInput,
  safeDecodeURIComponent,
  stripPrefixes,
  stripGenericPrefixes,
  stripLightningPrefixes,
  stripCashuPrefixes,
  inputVariants,
} from "./normalize";

// Proof composition primitives
export {
  buildExactOfflineAmountIndex,
  composeSatoshis,
  composeFiat,
  getRoundedFiatMinorUnitForSats,
  getSatRangeForDisplayedFiatMinorUnit,
} from "./offline";

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
  ReceiveExecuteFinalizedResult,
  ReceiveExecutePendingReason,
  ReceiveExecutePendingResult,
  ReceiveExecuteResult,
  MachineSnapshot,
  MeltQuoteMethod,
  MintQuoteMethod,
  NotificationHandlerMap,
  PaymentQuoteMethod,
  ScanSourceResult,
  ScanSources,
  NfcIOAdapter,
  RecipientProfile,
  SendEntrySource,
} from "./machine/types";

export type { MintAvailability } from "./machine/selectMintContext";

// Amount actions (amount screen action system)
export {
  createAmountActionManager,
  resolveAmount,
  resolutionEqual,
  computeQuickSendSuggestions,
} from "./amount-actions";
export type {
  AmountInputMode,
  CoreAmountResolution,
  AmountResolution,
  CreateAmountActionManagerConfig,
  AmountActionManager,
  QuickSendSuggestion,
  QuickSendConfig,
} from "./amount-actions";

// Screen actions (post-terminal screen action system)
export {
  createScreenActionSession,
  createScreenActionManager,
  getAvailableActions,
  isPaymentRequestPreview,
  shouldApplyEntryUpdate,
  mergeEntryUpdate,
  decorateEntry,
  meltOperationToScreenActionEntry,
  createDefaultScreenActionHandlers,
} from "./screen-actions";
export type {
  ActionAvailability,
  ActionHandler,
  ActionState,
  ActionVariant,
  CreateScreenActionSessionConfig,
  DecoratedEntryFields,
  DefaultScreenActionHandlersConfig,
  MeltOperationLike,
  NavigationCallbacks,
  ScreenActionEntrySeed,
  ScreenActionEntryUpdateSubscriber,
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenActionsBridge,
  ScreenActionSession,
  ScreenActionSessionSnapshot,
  ScreenType,
} from "./screen-actions";

// Formatting utilities
export { FormattedTimestamp } from "./formatting";
export { FormattedString, type TruncateMode } from "./formatting";
export { localizeReason, type LocalizedReason } from "./formatting";
export {
  isFiatUnit,
  majorToMinor,
  minorToRawInput,
  unitMinorDecimals,
  unitSymbol,
} from "./formatting";

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
} from "./lnurl";

// Recipient identity resolution (Lightning Address → Nostr hex pubkey)
export { fetchNip05Pubkey } from "./nip05";
export { resolveRecipientPubkey } from "./recipient";

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
} from "./safeFetch";

export { createNostrMintEnrichment } from "./nostr-mint-enrichment";
export type {
  NostrMintEnrichment,
  NostrMintEnrichmentConfig,
} from "./nostr-mint-enrichment";

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
  DestinationKind,
  DestinationIcon,
  DestinationAction,
  DestinationAmount,
  DestinationRecipientRef,
  DestinationRecipient,
  DestinationDescriptor,
  AmountEntryConstraints,
  MintListItem,
  MintCatalogEntry,
  MintContactProfile,
  MintContactProfileResolver,
  MintSelectionResult,
  MintCandidate,
  MintReviewInfo,
  MintReviewRecommendation,
  MintReviewsFetcher,
  MintReviewsSummary,
  GuardResult,
  WalletCapability,
  CapabilityCheckResult,
  ExactOfflineAmountIndex,
  FiatMinorUnitSatRange,
  CompositionResult,
  FiatCompositionResult,
} from "./types";

// Mesh transport (Nut Drop): token classification on receive and the
// auto-redeem orchestrator. Ecash is locked to the recipient's announced
// P2PK key and broadcast on the public mesh — no in-band handshake.
export * from "./transport";
