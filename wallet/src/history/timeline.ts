// Thin re-export: the timeline implementation now lives in ./timeline/ as a
// declarative flow engine (flows.ts data + engine.ts algorithm + classify.ts).
// This file keeps every pre-engine `from "./timeline"` import path working.

export {
  buildTimeline,
  buildTimelineModel,
  getCardLabel,
  getHistoryEntryOnchainMeltAddress,
  getHistoryEntryOnchainMintAddress,
  getStatusColorType,
  getStatusHeader,
  isSettledStepType,
  mintHistoryEntryExpired,
} from "./timeline/index";
export type {
  BuildTimelineInput,
  OnchainConfirmationProgress,
  TimelineFlowVariant,
  TimelineItem,
  TimelineModel,
  TimelineOutcome,
  TimelineOutcomeKind,
  TimelineStep,
  TimelineStepType,
} from "./timeline/index";
