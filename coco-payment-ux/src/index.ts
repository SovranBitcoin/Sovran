// ---------------------------------------------------------------------------
// coco-payment-ux — public API
// ---------------------------------------------------------------------------

// Core factory (framework-agnostic entry point)
export {
  createCocoPaymentUX,
  createMachineFromInstance,
  createWalletContextTracker,
  type CocoPaymentUXConfig,
  type CocoPaymentUXInstance,
  type CreateMachineFromInstanceConfig,
  type WalletContextTracker,
} from './core';

// Re-export Manager type so consumers don't need to import coco-cashu-core
export type { Manager } from '@cashu/coco-core';

// Typed accessors for coco Manager internals — see api/managerInternals.ts
export {
  getReadyProofs,
  getWallet,
  listMeltOperationsByState,
  deleteMintOperation,
} from './api/managerInternals';

// Machine (state machine core)
export { createPaymentMachine } from './machine/createMachine';
export { resolveNext } from './machine/resolveNext';
export { selectMintContext, buildMintAvailability } from './machine/selectMintContext';

// Pipeline utilities (usable standalone)
export { parsePaymentInput, isBip321 } from './parse';
export { resolveIntent } from './intent';
export { defaultDetectors } from './detectors';
export { annotateOptions } from './annotate';
export { selectMint, selectMintForMelt, type MintSelectionConfig } from './mint-selection';
export { validateIntent, checkWalletCapabilities, checkAllCapabilities } from './guards';
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
  NotificationHandlerMap,
  ScanSourceResult,
  ScanSources,
  NfcIOAdapter,
} from './machine/types';

export type {
  MintAvailability,
  MintAvailabilityStatus,
  MintAvailabilityReason,
  MintResolutionContext,
} from './machine/selectMintContext';

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

// Nostr (NIP-17 gift wrap + relay publishing)
export {
  sendDirectMessageToRelays,
  buildGiftWrappedDM,
  buildGiftWrappedDMPair,
  unwrapGiftWrap,
  type UnwrappedDM,
} from './nostr';

// Domain types
export type {
  Detectors,
  PaymentRequestInfo,
  PaymentRequestTransport,
  WalletContext,
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
