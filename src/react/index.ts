// ---------------------------------------------------------------------------
// colada/react — React hooks & provider
// ---------------------------------------------------------------------------

// Provider & flow hooks
export {
  ColadaProvider,
  useColadaContext,
  usePaymentFlowMachine,
  type DeepLinkConfig,
  type ScreenActionsBridge,
} from './ColadaProvider';

// Scan types (machine.scan uses these)
export type {
  URDecoderLike,
  ScanOptions,
  ProcessResult,
  ScanSourceResult,
  ScanSources,
} from '../machine/types';

// Post-terminal screen actions
export {
  useScreenActions,
  useScreenActionsWithConfig,
  type BoundAction,
  type UseScreenActionsConfig,
  type UseScreenActionsResult,
} from './useScreenActions';

// Re-export suggestion types for convenience
export type { QuickSendSuggestion, QuickSendConfig } from '../amount-actions/types';

// Low-level machine hook (for wallets not using ColadaProvider)
export { usePaymentMachine, type UsePaymentMachineConfig } from './usePaymentMachine';

// Execution state subscription
export { useExecutionState } from './useExecutionState';
