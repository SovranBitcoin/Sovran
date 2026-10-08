// ---------------------------------------------------------------------------
// Timeline engine — one algorithm for every flow
// ---------------------------------------------------------------------------
//
// A flow is an ordered list of EVENTS. The timeline is every event that has
// happened, in the past tense, plus exactly one open slot: the event being
// waited on, in the present tense. Nothing further ahead is drawn.
//
// That shape is add-only by construction. Progress finishes the open slot and
// opens the next one below it; a failure, expiry or reversal lands IN the open
// slot. No transition has a row to take away, so the renderer never has to
// animate one out.
//
// "How far did it get" is the max over three sources, so it can only advance:
// the events' own MONOTONE `done` predicates, the evidence a terminal outcome
// can still read off the entry, and the rows the caller says it already drew
// (`doneRowKeys`). Every row keeps a stable `rowKey`; whatever lands in the
// open slot inherits that slot's key, so it morphs in place.

import { logger } from "../../logger";
import { createTimelineContext } from "./context";
import { TIMELINE_FLOWS } from "./flows";
import type {
  BuildTimelineInput,
  FlowDef,
  MilestoneDef,
  OutcomeDef,
  TimelineContext,
  TimelineItem,
  TimelineModel,
  TimelineStep,
} from "./types";

/** How long a reversal may be in flight before the row says it is stuck. */
const REVERSAL_SLOW_AFTER_MS = 60_000;

function doneRow(
  milestone: MilestoneDef,
  ctx: TimelineContext,
  isFinal: boolean,
): TimelineStep {
  const copy = milestone.completed(ctx);
  const step: TimelineStep = {
    id: milestone.id,
    rowKey: milestone.id,
    state: milestone.state,
    displayLabel: copy.label,
    // The last event of a flow that ran to its end is the success row.
    stepType: isFinal ? "success" : "complete",
  };
  if (copy.timestamp !== undefined) step.timestamp = copy.timestamp;
  if (copy.info !== undefined) step.info = copy.info;
  if (milestone.ring?.(ctx)) step.confirmationRing = true;
  return step;
}

/**
 * A state no flow knows (a newer coco, a corrupt row). An empty card says
 * nothing and a guess could invent a payment, so it gets one row that claims
 * exactly what is known: that we cannot read it.
 */
function unknownRow(ctx: TimelineContext): TimelineStep {
  return {
    id: "unknown",
    rowKey: "unknown",
    state: ctx.state,
    displayLabel: ctx.paymentCopy.text("timeline.unknown.label"),
    info: ctx.paymentCopy.text("timeline.unknown.info"),
    stepType: "waiting",
  };
}

/** How many leading events have happened. */
function countDone(
  milestones: MilestoneDef[],
  ctx: TimelineContext,
  outcome: OutcomeDef | undefined,
): number {
  let count = 0;
  const through = outcome?.doneThrough?.(ctx) ?? null;
  milestones.forEach((milestone, index) => {
    if (
      milestone.done(ctx) ||
      milestone.id === through ||
      ctx.doneRowKeys.includes(milestone.id)
    ) {
      count = index + 1;
    }
  });
  return count;
}

function buildSteps(
  flow: FlowDef,
  ctx: TimelineContext,
): {
  steps: TimelineStep[];
  kind: TimelineModel["outcome"]["kind"];
  doneCount: number;
  recheckAt?: number;
} {
  if (flow.known && !flow.known(ctx)) {
    return { steps: [unknownRow(ctx)], kind: "pending", doneCount: 0 };
  }

  const milestones = flow.milestones.filter(
    (milestone) => milestone.included?.(ctx) ?? true,
  );
  const outcome = flow.outcomes.find((candidate) => candidate.when(ctx));
  const doneCount = countDone(milestones, ctx, outcome);
  const open = milestones[doneCount];
  const ranToEnd = !outcome && !open;
  const steps = milestones
    .slice(0, doneCount)
    .map((milestone, index) =>
      doneRow(milestone, ctx, ranToEnd && index === doneCount - 1),
    );

  if (outcome) {
    const row = outcome.row(ctx);
    const step: TimelineStep = {
      id: outcome.id,
      // The open slot's key, so the outcome morphs the row that was waiting.
      // An outcome with no slot left (it happened after the last event) gets
      // a row of its own below everything else.
      rowKey: open?.id ?? outcome.id,
      state: row.state,
      displayLabel: row.label,
      stepType: row.stepType,
    };
    if (row.timestamp !== undefined) step.timestamp = row.timestamp;
    if (row.info !== undefined) step.info = row.info;
    steps.push(step);
    return { steps, kind: outcome.kind, doneCount };
  }

  if (!open) {
    return { steps, kind: steps.length === 0 ? "empty" : "settled", doneCount };
  }

  if (ctx.cancelling || flow.reversing?.(ctx)) {
    // coco does not retry a reversal that threw; the entry just stays here.
    // After a while the row has to stop implying it is about to finish.
    const slowAt =
      ctx.since === null ? null : ctx.since + REVERSAL_SLOW_AFTER_MS;
    const slow =
      !ctx.cancelling && slowAt !== null && ctx.currentTime >= slowAt;
    steps.push({
      id: "cancelling",
      rowKey: open.id,
      state: "rolling_back",
      displayLabel: ctx.paymentCopy.text("timeline.cancelling.label"),
      info: ctx.paymentCopy.text(
        slow ? "timeline.cancelling.slowInfo" : "timeline.cancelling.info",
      ),
      stepType: slow ? "waiting" : "current",
    });
    return {
      steps,
      kind: "pending",
      doneCount,
      ...(slow || ctx.cancelling || slowAt === null
        ? {}
        : { recheckAt: slowAt }),
    };
  }

  const copy = open.active(ctx);
  const step: TimelineStep = {
    id: open.id,
    rowKey: open.id,
    state: open.state,
    displayLabel: copy.label,
    stepType: copy.style ?? "current",
  };
  if (copy.timestamp !== undefined) step.timestamp = copy.timestamp;
  if (copy.info !== undefined) step.info = copy.info;
  if (open.ring?.(ctx)) step.confirmationRing = true;
  steps.push(step);
  return {
    steps,
    kind: "pending",
    doneCount,
    ...(copy.recheckAt !== undefined ? { recheckAt: copy.recheckAt } : {}),
  };
}

function buildModel(ctx: TimelineContext): TimelineModel {
  const flow = TIMELINE_FLOWS[ctx.variant];
  // Quote expiry when cheaply known (melt quote row). Mint bolt11 expiry is
  // deliberately not re-decoded here; the expired OUTCOME still covers it.
  const expiresAt =
    ctx.entry.type === "melt" && ctx.meltQuote?.expiry
      ? ctx.meltQuote.expiry * 1000
      : undefined;

  if (!flow) {
    return {
      steps: [unknownRow(ctx)],
      outcome: { kind: "pending" },
      doneRowKeys: [],
      flow: ctx.variant,
    };
  }

  const { steps, kind, doneCount, recheckAt } = buildSteps(flow, ctx);
  return {
    steps,
    outcome: { kind },
    flow: ctx.variant,
    // Only events count, and by position rather than by name: the row after
    // them is the open slot or the outcome standing in it, and an outcome may
    // share its slot's id ("claimed").
    doneRowKeys: steps.slice(0, doneCount).map((step) => step.rowKey),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(recheckAt !== undefined ? { recheckAt } : {}),
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
