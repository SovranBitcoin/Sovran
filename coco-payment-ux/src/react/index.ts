// ---------------------------------------------------------------------------
// coco-payment-ux/react — React hooks & provider
// ---------------------------------------------------------------------------

// Provider & flow hooks
export {
  PaymentFlowProvider,
  usePaymentFlowMachine,
  usePaymentFlowMint,
  usePaymentFlowMintContext,
  type PaymentFlowProviderConfig,
  type PaymentFlowProviderProps,
  type PaymentFlowRefs,
  type UsePaymentFlowMachineConfig,
} from './PaymentFlowProvider';

// Clipboard paste
export { usePaste, type UsePasteConfig } from './usePaste';

// Scan/paste/NFC input processing with UR assembly
export {
  usePaymentStringProcessor,
  type URDecoderLike,
  type ScanData,
  type ProcessResult,
  type UsePaymentStringProcessorConfig,
} from './usePaymentStringProcessor';

// Post-terminal screen actions
export {
  useScreenActions,
  type BoundAction,
  type UseScreenActionsConfig,
  type UseScreenActionsResult,
} from './useScreenActions';

// Payment input parsing + intent + guards
export {
  usePaymentInput,
  type PaymentInputResult,
  type UsePaymentInputConfig,
} from './usePaymentInput';

// Low-level machine hook (for wallets not using PaymentFlowProvider)
export { usePaymentMachine, type UsePaymentMachineConfig } from './usePaymentMachine';

// Execution state subscription
export { useExecutionState } from './useExecutionState';

// Offline send suggestions
export {
  useAmountEntry,
  type SendMode,
  type OfflineSuggestion,
  type AmountEntrySuggestions,
  type AmountEntryResult,
  type FiatContext,
  type UseAmountEntryConfig,
} from './useAmountEntry';

// Option annotation
export { useAnnotatedOptions } from './useAnnotatedOptions';

// Proof composition memoization
export { useProofComposition, type UseProofCompositionConfig } from './useProofComposition';

// Amount input state management
export {
  useAmountActions,
  type UseAmountActionsConfig,
  type UseAmountActionsResult,
} from './useAmountActions';

// Legacy aliases for migration
export { usePaymentMachine as usePaymentResolver } from './usePaymentMachine';
export type { UsePaymentMachineConfig as UsePaymentResolverConfig } from './usePaymentMachine';
