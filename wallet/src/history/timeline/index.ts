// Declarative payment-timeline engine. Public surface of history/timeline:
// the legacy buildTimeline contract, the model-producing buildTimelineModel
// (future renderer), classification helpers, and the entry helpers other
// history modules consume.

export { buildTimeline, buildTimelineModel } from "./engine";
export {
  getCardLabel,
  getStatusColorType,
  getStatusHeader,
  isSettledStepType,
} from "./classify";
export {
  getHistoryEntryOnchainMeltAddress,
  getHistoryEntryOnchainMintAddress,
  mintHistoryEntryExpired,
} from "./context";
export { timelinePhase } from "./phase";
export type { PaymentPhase } from "./phase";
export type {
  BuildTimelineInput,
  TimelineFlowVariant,
  TimelineModel,
  TimelineStep,
  TimelineStepType,
} from "./types";
