// ---------------------------------------------------------------------------
// Timeline engine — one algorithm for every flow
// ---------------------------------------------------------------------------
//
// Resolve the flow variant → run its terminal outcomes in order (first match
// displaces the timeline tail) → otherwise find the highest reached milestone
// (max index over MONOTONE `reached` predicates, so out-of-order state
// observations can only advance the position, never regress it) and style
// steps as complete / active / upcoming. Every emitted step carries a stable
// `id` and a `rowKey`; terminal steps INHERIT the rowKey of the milestone
// slot they displace so in-place morph animations survive the swap.

import { logger } from "../../logger";
import { createTimelineContext } from "./context";
import { isSettledStepType } from "./classify";
import { TIMELINE_FLOWS } from "./flows";
import type {
  BuildTimelineInput,
  FlowDef,
  TimelineContext,
  TimelineItem,
  TimelineModel,
  TimelineStep,
  TimelineStepType,
} from "./types";

function runOutcomeRows(
  flow: FlowDef,
  ctx: TimelineContext,
): { steps: TimelineStep[]; kind: TimelineModel["outcome"]["kind"] } | null {
  for (const outcome of flow.outcomes) {
    if (!outcome.when(ctx)) continue;
    const steps = outcome.rows(ctx).map((row): TimelineStep => {
      const step: TimelineStep = {
        id: row.id ?? row.slot,
        rowKey: row.slot,
        state: row.state,
        displayLabel: row.label,
        stepType: row.stepType,
      };
      if (row.timestamp !== undefined) step.timestamp = row.timestamp;
      if (row.info !== undefined) step.info = row.info;
      return step;
    });
    return { steps, kind: outcome.kind };
  }
  return null;
}

function runMilestones(flow: FlowDef, ctx: TimelineContext): TimelineStep[] {
  const { milestones } = flow;
  let activeIndex = -1;
  milestones.forEach((milestone, index) => {
    if (milestone.reached(ctx)) activeIndex = index;
  });
  if (activeIndex === -1) return [];

  const lastIndex = milestones.length - 1;
  return milestones.map((milestone, index): TimelineStep => {
    // Resolve stepType BEFORE copy: the active style may log (e.g.
    // onchainPaidStepType) and the old switch evaluated stepType before info.
    let stepType: TimelineStepType;
    if (index < activeIndex) {
      stepType = "complete";
    } else if (index === activeIndex) {
      stepType =
        milestone.activeStyle?.(ctx) ??
        (index === lastIndex ? "success" : "current");
    } else if (index === activeIndex + 1 && milestone.upcomingStyle) {
      stepType = milestone.upcomingStyle(ctx);
    } else {
      stepType = "future-small";
    }

    const copy = milestone.copy(ctx);
    const step: TimelineStep = {
      id: milestone.id,
      rowKey: milestone.id,
      state: copy.state,
      displayLabel: copy.label,
      stepType,
    };
    if (copy.timestamp !== undefined) step.timestamp = copy.timestamp;
    if (copy.info !== undefined) step.info = copy.info;
    if (milestone.ring?.(ctx)) step.confirmationRing = true;
    return step;
  });
}

function buildModel(ctx: TimelineContext): TimelineModel {
  const flow = TIMELINE_FLOWS[ctx.variant];
  // Quote expiry when cheaply known (melt quote row). Mint bolt11 expiry is
  // deliberately not re-decoded here; the expired OUTCOME still covers it.
  const expiresAt =
    ctx.entry.type === "melt" && ctx.meltQuote?.expiry
      ? ctx.meltQuote.expiry * 1000
      : undefined;

  if (!flow) return { steps: [], outcome: { kind: "empty" } };

  const terminal = runOutcomeRows(flow, ctx);
  if (terminal) {
    return {
      steps: terminal.steps,
      outcome: { kind: terminal.kind },
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }

  const steps = runMilestones(flow, ctx);
  const kind =
    steps.length === 0
      ? "empty"
      : steps.every((step) => isSettledStepType(step.stepType))
        ? "settled"
        : "pending";
  return {
    steps,
    outcome: { kind },
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

export function buildTimelineModel(input: BuildTimelineInput): TimelineModel {
  const ctx = createTimelineContext(input);
  const model = buildModel(ctx);
  const timeline = model.steps;
  logger.info("history.timeline.build.result", {
    type: input.historyEntry.type,
    state: String(
      (input.historyEntry as Record<string, unknown>).state ?? "",
    ),
    itemCount: timeline.length,
    stepTypes: timeline.map((item) => item.stepType),
    currentStates: timeline
      .filter(
        (item) =>
          item.stepType === "current" ||
          item.stepType === "waiting" ||
          item.stepType === "next-pending" ||
          item.stepType === "success" ||
          item.stepType === "expired" ||
          item.stepType === "rolled-back" ||
          item.stepType === "already-spent",
      )
      .map((item) => item.state),
    hasMeltQuote: !!input.meltQuote,
    tokenCreated: input.tokenCreated ?? null,
    nostrSent: input.nostrSent ?? null,
    hasOnchainConfirmationProgress: !!input.onchainConfirmationProgress,
    onchainSatisfied: input.onchainConfirmationProgress?.isSatisfied ?? null,
  });
  return model;
}

/** Legacy consumer contract: the model's steps mapped onto the exact
 *  pre-engine TimelineItem field set (no id/rowKey). */
export function buildTimeline(input: BuildTimelineInput): TimelineItem[] {
  return buildTimelineModel(input).steps.map((step) => {
    const item: TimelineItem = {
      state: step.state,
      displayLabel: step.displayLabel,
      stepType: step.stepType,
    };
    if (step.timestamp !== undefined) item.timestamp = step.timestamp;
    if (step.info !== undefined) item.info = step.info;
    if (step.confirmationRing !== undefined) {
      item.confirmationRing = step.confirmationRing;
    }
    return item;
  });
}
