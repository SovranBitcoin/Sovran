export {
  usePaymentInput,
  type PaymentInputResult,
  type UsePaymentInputConfig,
} from './usePaymentInput';
export { usePaymentMachine, type UsePaymentMachineConfig } from './usePaymentMachine';
export { useExecutionState } from './useExecutionState';
export {
  useAmountEntry,
  type SendMode,
  type OfflineSuggestion,
  type AmountEntrySuggestions,
  type AmountEntryResult,
  type FiatContext,
  type UseAmountEntryConfig,
} from './useAmountEntry';
export { useAnnotatedOptions } from './useAnnotatedOptions';
export { useProofComposition, type UseProofCompositionConfig } from './useProofComposition';

// Legacy aliases for migration
export { usePaymentMachine as usePaymentResolver } from './usePaymentMachine';
export type { UsePaymentMachineConfig as UsePaymentResolverConfig } from './usePaymentMachine';
