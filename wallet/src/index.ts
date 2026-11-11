// ---------------------------------------------------------------------------
// colada — public API
// ---------------------------------------------------------------------------

// Core factory (framework-agnostic entry point)
export { createColada } from "./core";

// Re-export Manager type so consumers don't need to import coco-cashu-core
export type { Manager } from "@cashu/coco-core";

// P2PK locks — the terms a send applies, and what a token's conditions say.
export {
  describeSpendingConditions,
  LOCK_CLOCK_SKEW_MS,
  P2PK_RECLAIM_ENABLED,
} from "./p2pk";
export type { P2pkLockSpec, SpendingConditions } from "./p2pk";

// Wallet seed helpers
export {
  createCashuSeedGetter,
  deriveStandardCashuSeed,
} from "./wallet-seed";

// Onchain confirmations, explorer links and fee acceleration
export {
  DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
  buildOnchainConfirmationProgressFromTx,
  accelerationTotalSats,
  createAccelerationInvoice,
  createMempoolSpaceChainAdapter,
  defaultAccelerationBidSats,
  defaultChainAdapter,
  fetchAccelerationEstimate,
  fetchAccelerationStatus,
  fetchAddressOutpointCandidates,
  fetchAverageBlockTimeMinutes,
  fetchMempoolAddressStats,
  getOnchainConfirmationProgress,
  isAcknowledgedAccelerationStatus,
  matchUniqueSendOutpoint,
  MempoolAddressStatsSchema,
  parseOutpoint,
  shouldStopTxConfirmationPolling,
  summarizeMempoolAddress,
  transactionExplorerUrlForTxid,
} from "./chain";
export type {
  AccelerationEstimate,
  MempoolAddressSummary,
  MempoolAddressStats,
  OnchainConfirmationProgress as ChainOnchainConfirmationProgress,
} from "./chain";

// Copy / i18n
export {
  createPaymentCopyGroups,
  createPaymentCopyResolver,
} from "./copy";
export type { PaymentCopyResolver } from "./copy";

// History / payment-state timeline
export {
  buildTimeline,
  buildTimelineModel,
  bucketTransaction,
  getCardLabel,
  getHistoryEntryRefreshLabel,
  getSendTokenReachabilityWarning,
  getStatusColorType,
  getStatusHeader,
  groupAiRequests,
  isAiRequestLeg,
  isSettledStepType,
  isPendingPaymentRequestEntry,
  normalizeHistoryEntry,
  entryStateRank,
  isTerminalFailureState,
  normalizeContractState,
  normalizeTimelineMeltState,
  normalizeTimelineMintState,
  isCancellablePendingEcash,
  railHeaderTitle,
  transactionHeaderTitle,
  isMeltQuotePaid,
  isMeltQuoteReadyToPay,
  isMintQuotePaymentObserved,
  isPendingTransaction,
  isReceiveTokenPending,
  isReceiveTokenRedeemed,
  isSendTokenCancelled,
  isSendTokenComplete,
  isSettledReceiveHistoryEntry,
  isSettledSpendHistoryEntry,
  matchesTransactionFilters,
  matchesTransactionPaymentType,
  shouldShowMintOfflineWarning,
} from "./history";
export type {
  AiRequestGroup,
  AiRequestState,
  TimelineFlowVariant,
  TimelineStep,
  TimelineStepType,
  TransactionDirection,
  TransactionPaymentType,
} from "./history";

export { meltMethodForTarget } from "./melt-target";

// Transaction annotations (per-transaction side-data: counterparty, scan
// source, P2PK lock, distribution, location, swap grouping). colada owns the
// model + keying + selectors; the consuming wallet supplies persistence.
export {
  annotationKey,
  candidateKeys,
  decodeAnnotation,
  encodeAnnotation,
  getCounterparty,
  getScanSource,
  getSwap,
  getZap,
  describeSendLock,
  isP2PKLocked,
  mergeAnnotationRecords,
  rawAnnotationKey,
} from "./annotations";
export type {
  AnnotationRecord,
  AnnotationStoreAdapter,
  DistributionSource,
  ScanMethod,
  TransactionAnnotation,
  ZapReceiptKind,
} from "./annotations";

// Adapter contracts
export type {
  ChainTransactionStatus,
  JsonRecord,
} from "./adapters";

// Subscription bus
export type {
  ColadaSubscriptionBus,
  ColadaSubscriptionEvent,
} from "./subscriptions";

// Mint rebalance engine (melt/mint hops between mints, bounded
// re-preparation, reconciliation, error classification)
export {
  createChainSteps,
  createRebalanceEngine,
  createRebalanceLock,
  insertStepsAfter,
} from "./rebalance";
export { meltNeverSent, meltSettledUnpaid } from "./melt-outcome";
export type {
  RebalanceEngine,
  RebalanceEventSink,
  RebalanceLegStatus,
  RebalanceLegUpdate,
  RebalanceRoute,
  RebalanceRoutingInfo,
  RebalanceTransferOutcome,
  RebalanceWalletPort,
} from "./rebalance";

// Reusable mint-quote singleton (standing bolt12 offer / onchain address)
export {
  ensureStandingPaymentRequest,
  paymentRequestEncodingsHandedOut,
  paymentRequestEncodingsVersion,
  reencodeSingleUsePaymentRequest,
  rotateStandingPaymentRequest,
  standingPaymentRequestKey,
  type SingleUseReencodeOptions,
} from "./payment-request-receive";
export {
  rotateReusableMintQuote,
  reusableQuoteKey,
  type ReusableQuoteIdentityStore,
} from "./quotes/reusable";

// Machine (state machine core)
export { createPaymentMachine } from "./machine/createMachine";

// Pipeline utilities (usable standalone)
export { parsePaymentInput, looksLikeBitcoinAddress } from "./parse";
export {
  buildBip321OnchainUri,
  buildUnifiedBip321Uri,
} from "./bip321";
export { describeDestination } from "./destination-descriptor";
export {
  decodeEcashTokenMetadata,
  isValidEcashToken,
  isWellFormedEcashToken,
} from "./ecash";
export {
  decodePaymentRequestInfo,
  lockableMintsFromRequest,
} from "./payment-request";
export { decodeBolt11Invoice } from "./bolt11";
export { defaultDetectors } from "./detectors";
export {
  accountMintUrls,
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveSupportedUnitsFromInfo,
  getMintMethodCapability,
  hasMintSupportingMethod,
  configureEnabledPaymentMethods,
  pickHighestBalanceUnit,
  pickMintForUnit,
  resolveReceiveMethodMint,
} from "./mint-capabilities";
export {
  FIAT_UNITS,
  SWITCHABLE_UNITS,
} from "./units/registry";
export {
  ACCOUNT_UNITS,
  accountUnitLabel,
  accountUnitName,
  isAccountUnit,
  isTestnutUnit,
  toAccountUnit,
  toRealUnit,
} from "./units/accounts";
// Proof composition primitives
export { composeSatoshis } from "./offline";

// Machine types
export type {
  StepDataMap,
  StepHandlerMap,
  MachineOperations,
  PaymentMachine,
  NotificationHandlerMap,
  ScanSources,
  NfcIOAdapter,
  RecipientProfile,
} from "./machine/types";

// Screen actions (post-terminal screen action system)
export {
  decodePaymentRequestEntryPhase,
  shouldApplyEntryUpdate,
  mergeEntryUpdate,
  meltOperationToScreenActionEntry,
  startNewEcashSendIfFinished,
} from "./screen-actions";
export type {
  ActionVariant,
  DecoratedEntryFields,
  MeltOperationLike,
  NavigationCallbacks,
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionName,
  ScreenActionsBridge,
  ScreenType,
} from "./screen-actions";

// Formatting utilities
export { FormattedString } from "./formatting";
export {
  isFiatUnit,
  minorToRawInput,
  unitMinorDecimals,
  unitSymbol,
} from "./formatting";

// LNURL resolution (lightning address & lnurlp → bolt11)
export {
  requestInvoiceFromLnurl,
  parseLightningAddress,
  decodeUrlOrAddress,
  isLightningInvoiceBolt11,
} from "./lnurl";

// Recipient identity resolution (Lightning Address → Nostr hex pubkey)
export {
  fetchNip05Pubkey,
  parseNip05Identifier,
  verifyNip05,
  type Nip05Verification,
} from "./nip05";
export { normalizeNostrPubkey } from "./recipient";

// Cancellable-fetch primitives (timeout + AbortSignal). Hermes lacks
// `DOMException`, so callers must duck-type aborts via `isAbortError`
// rather than `instanceof DOMException`. The same primitives back the
// app's `apiClient` so there's one canonical implementation.
export {
  combineSignals,
  isAbortError,
  timeoutSignal,
  withTimeout,
  type RequestControls,
} from "./safeFetch";

export { createNostrMintEnrichment } from "./nostr-mint-enrichment";

// Domain types
export type {
  Detectors,
  WalletContext,
  MintMethodCapabilityMap,
  MintMethodUnitCapability,
  MintPaymentMethod,
  AnnotatedOption,
  DestinationIcon,
  DestinationDescriptor,
  MintListItem,
  MintCatalogEntry,
  MintCandidate,
  MintReviewInfo,
  MintReviewRecommendation,
  MintReviewsSummary,
} from "./types";

// Mesh transport (Nut Drop): token classification on receive and the
// auto-redeem orchestrator. Ecash is locked to the recipient's announced
// P2PK key and broadcast on the public mesh — no in-band handshake.
export * from "./transport";

export { disposeReusableQuoteFlights } from "./quotes/reusable";
export { resetMeltTarget } from "./melt-target";
export { disposeCashuSeedGetter } from "./wallet-seed";

// Ecash the redux-era releases stored themselves: read from the old row and
// received through the open wallet.
export * from "./legacy-ecash";
