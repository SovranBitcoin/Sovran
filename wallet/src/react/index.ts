// ---------------------------------------------------------------------------
// colada/react — React hooks & provider
// ---------------------------------------------------------------------------

// Provider & flow hooks
export {
  ColadaProvider,
  useColadaContext,
  useColadaManager,
  useColadaTrustedMintUrls,
  usePaymentFlowMachine,
  type DeepLinkConfig,
  type ColadaProviderProps,
} from "./ColadaProvider";

// Transaction list read model
export { useColadaTransactions } from "./useColadaTransactions";

// Single-entry annotation read model
export { useColadaTransactionAnnotation } from "./useColadaTransactionAnnotation";

// Balance breakdown read model
export { useColadaBalance } from "./useColadaBalance";

export { useReusableMintQuote } from "./useReusableMintQuote";
export {
  useStandingPaymentRequest,
  type UseStandingPaymentRequestResult,
} from "./useStandingPaymentRequest";

// Post-terminal screen actions
export {
  useScreenActions,
  type BoundAction,
  type UseScreenActionsResult,
} from "./useScreenActions";

// Re-export suggestion types for convenience
export type { QuickSendSuggestion } from "../amount-actions/types";

// Execution state subscription
export { useExecutionState } from "./useExecutionState";
