// The one-word reading of a timeline: what a surface with room for a single
// state (the payment toast) says about a payment. It is read off the same
// model the detail screen draws, so the two cannot tell different stories.

import type { TimelineModel } from "./types";

/**
 * - `working`: the wallet itself is busy with it.
 * - `handed-off`: our part is done; someone else acts next (a recipient
 *   claiming, a payer paying).
 * - `slow`: still open, and long enough (or uncertain enough) to say so. Never
 *   a failure: the payment may still complete.
 * - `done` / `failed`: it ended.
 * - `cancelled`: the person backed out of it. A timeline never reports this
 *   (a reversal reads as `failed`: the money came back); the flow that was
 *   cancelled does.
 */
export type PaymentPhase =
  | "working"
  | "handed-off"
  | "slow"
  | "done"
  | "failed"
  | "cancelled";

/** The phase a timeline shows, or null when the model says nothing (an entry
 *  its flow does not understand). */
export function timelinePhase(
  model: Pick<TimelineModel, "outcome" | "steps">,
): PaymentPhase | null {
  switch (model.outcome.kind) {
    case "settled":
      return "done";
    case "failed":
    case "expired":
    case "rolled-back":
    case "already-spent":
      return "failed";
    case "empty":
      return null;
    case "pending": {
      // The open slot is the last row; every row before it has happened.
      const open = model.steps[model.steps.length - 1];
      if (!open) return null;
      if (open.stepType === "next-pending") return "handed-off";
      if (open.stepType === "waiting") return "slow";
      return "working";
    }
  }
}
