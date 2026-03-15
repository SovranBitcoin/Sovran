// ---------------------------------------------------------------------------
// coco-payment-ux — public API
// ---------------------------------------------------------------------------

// Debug (for agent tracing)
export { debugLog, serializeFlowContext, serializeWalletContext } from './debugLog';

// Machine (state machine core)
export { createPaymentMachine } from './machine/createMachine';
export { resolveNext } from './machine/resolveNext';
export { selectMintContext } from './machine/selectMintContext';

// Pipeline utilities (usable standalone)
export { parsePaymentInput } from './parse';
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
  PaymentMachine,
  ExecutionState,
  ErrorCode,
  MachineSnapshot,
} from './machine/types';

export type {
  MintAvailability,
  MintAvailabilityStatus,
  MintAvailabilityReason,
  MintResolutionContext,
} from './machine/selectMintContext';

// Screen actions (post-terminal screen action system)
export { createScreenActionManager, getAvailableActions } from './screen-actions';
export type {
  ActionAvailability,
  ActionHandler,
  ActionState,
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenType,
} from './screen-actions';

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
  MintSelectionResult,
  MintCandidate,
  GuardResult,
  WalletCapability,
  CapabilityCheckResult,
  ExactOfflineAmountIndex,
  FiatMinorUnitSatRange,
  CompositionResult,
  FiatCompositionResult,
} from './types';
