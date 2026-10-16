// ---------------------------------------------------------------------------
// Timeline model + flow-definition types
// ---------------------------------------------------------------------------
//
// The declarative flow engine (engine.ts) renders every payment flow from the
// same algorithm: a flow is an ordered list of events (MilestoneDef) plus the
// terminal outcomes that can end it early (flows.ts). These are the shared
// vocabulary types.

import type { MeltQuoteBolt11Response } from "@cashu/cashu-ts";
import type { HistoryEntry } from "@cashu/coco-core";

import type {
  createPaymentCopyGroups,
  PaymentCopyResolver,
} from "../../copy";
import type { SpendingConditions } from "../../p2pk";

export interface OnchainConfirmationProgress {
  hasPayment: boolean;
  hasUnconfirmedPayment: boolean;
  receivedSats: number;
  currentConfirmations: number | null;
  requiredConfirmations: number;
  isSatisfied: boolean;
  /**
   * How deep our explorer actually sees the transaction, NOT capped at the
   * required count. Only a hint: the mint credits from its own node, and how
   * far past the requirement our count has run is how we notice it has not.
   */
  observedConfirmations?: number | null;
  /**
   * `requiredConfirmations` is the depth the mint itself published, not the
   * wallet's fallback. Nothing may be concluded about the mint's behaviour
   * from a depth we guessed.
   */
  requirementFromMint?: boolean;
}

export type TimelineStepType =
  | "complete"
  | "current"
  | "waiting"
  | "next-pending"
  | "future-small"
  | "expired"
  | "rolled-back"
  | "already-spent"
  | "success";

export interface TimelineItem {
  state: string;
  displayLabel: string;
  stepType: TimelineStepType;
  timestamp?: number;
  info?: string;
  /** Render the segmented on-chain confirmation ring on this row's dot (the
   *  onchain melt "In mempool" row and onchain mint deposit row). */
  confirmationRing?: boolean;
  /** Semantic step id (stable across states). Set on model-derived steps. */
  id?: string;
  /** Render-identity key: terminal steps inherit the rowKey of the milestone
   *  slot they displace so in-place morph animations survive the swap. */
  rowKey?: string;
}

export interface BuildTimelineInput {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  currentTime: number;
  tokenCreated?: boolean;
  nostrSent?: boolean;
  onchainConfirmationProgress?: OnchainConfirmationProgress | null;
  /**
   * True when an onchain SEND (melt) settled PAID with NO outpoint — the mint
   * paid it off-chain rather than broadcasting a transaction. The network phase
   * then collapses to a single "Settled off-chain" row (no mempool/confirming/
   * "Confirmed" claim). Only assert this once the quote itself reports PAID and
   * carries no outpoint (both come from the same quote row, so there is no
   * outpoint-lagging-state race).
   */
  onchainSettledInternally?: boolean;
  paymentCopy?: PaymentCopyResolver;
  /**
   * Public keys this wallet can sign for. Only affects whether an expired
   * lock reads as "you can take this back" or "anyone can", so a caller that
   * has not loaded them yet gets the cautious reading rather than a wrong one.
   */
  ourPubkeys?: readonly string[];
  /**
   * The user asked to cancel and the wallet has not answered yet. Draws the
   * same in-flight row as coco's own `rolling_back`, so the tap is answered
   * at once and the eventual outcome lands in the same slot.
   */
  cancelling?: boolean;
  /**
   * Row keys this timeline has already shown as happened, from the previous
   * model of the same entry (`TimelineModel.doneRowKeys`). A terminal state
   * forgets how far the flow got; the renderer remembers, and passing it back
   * is what guarantees a live timeline never drops a row it has drawn.
   */
  doneRowKeys?: readonly string[];
  /**
   * The flow those rows were drawn for (`TimelineModel.flow`). Row keys mean
   * something only inside their own flow: "claimed" is the second event of a
   * plain send and the third of a timed lock. If the entry has since resolved
   * to a different flow the remembered rows are ignored rather than re-read.
   */
  doneRowKeysFlow?: TimelineFlowVariant;
}

/** A fully-resolved timeline row: TimelineItem plus stable identity keys. */
export interface TimelineStep {
  id: string;
  rowKey: string;
  state: string;
  displayLabel: string;
  stepType: TimelineStepType;
  timestamp?: number;
  info?: string;
  confirmationRing?: boolean;
}

export type TimelineOutcomeKind =
  | "pending"
  | "settled"
  | "expired"
  | "failed"
  | "rolled-back"
  | "already-spent"
  | "empty";

export interface TimelineOutcome {
  kind: TimelineOutcomeKind;
}

export interface TimelineModel {
  steps: TimelineStep[];
  outcome: TimelineOutcome;
  /** Quote expiry (ms epoch) when cheaply known (melt quote expiry). */
  expiresAt?: number;
  /** Row keys of the events that have happened. Feed back as
   *  `BuildTimelineInput.doneRowKeys` on the next build of the same entry. */
  doneRowKeys: string[];
  /** The flow this model was built from; feed back as `doneRowKeysFlow`. */
  flow: TimelineFlowVariant;
  /**
   * When (ms epoch) the open slot's wording is due to change with nothing but
   * time passing: a payment that has been in flight long enough to say so.
   * The renderer rebuilds at that moment; absent when nothing is waiting.
   */
  recheckAt?: number;
}

export type TimelineFlowVariant =
  | "lightning-mint"
  | "onchain-mint"
  | "lightning-melt"
  | "onchain-melt"
  | "send"
  | "locked-send"
  | "payment-request-send"
  | "receive"
  | "payment-request-receive"
  | "unknown";

export type PaymentCopyGroups = ReturnType<typeof createPaymentCopyGroups>;

/** Everything a flow definition may read. Resolved once per build. */
export interface TimelineContext {
  entry: HistoryEntry;
  /** Raw entry state string (`String(entry.state)`). */
  state: string;
  createdAt: number;
  /** `amountToNumber(entry.amount)` — used by success-copy interpolations. */
  amount: number;
  meltQuote?: MeltQuoteBolt11Response;
  currentTime: number;
  tokenCreated?: boolean;
  nostrSent?: boolean;
  progress?: OnchainConfirmationProgress | null;
  onchainSettledInternally?: boolean;
  paymentCopy: PaymentCopyResolver;
  copy: PaymentCopyGroups;
  variant: TimelineFlowVariant;
  cancelling: boolean;
  doneRowKeys: readonly string[];
  /** The entry is a preview the user has not confirmed yet. */
  preview: boolean;
  /** When the entry last changed state, or null when it does not say. */
  since: number | null;
  /** How a paid request travelled, when the entry or its record says. */
  requestTransport: string | null;
  /** Normalized mint timeline state (mint entries only). */
  mintState: string | null;
  /** Normalized melt timeline state (melt entries only). */
  meltState: string | null;
  /** Receive payment-request synthetic pending row flag. */
  prPendingFlag: boolean;
  /**
   * The send's spending conditions, when it has any. Present for the
   * `locked-send` variant and null everywhere else, so a flow can read the
   * unlock date without every flow learning about locks.
   */
  lock: SpendingConditions | null;
}

/** What a row says while it is the one thing the flow is waiting on. */
export interface ActiveCopy {
  label: string;
  info?: string;
  /** 'current' = we are working; 'next-pending' = waiting on someone else;
   *  'waiting' = stalled and worth a warning. Defaults to 'current'. */
  style?: Extract<TimelineStepType, "current" | "next-pending" | "waiting">;
  /** When this wording is due to change by time alone (ms epoch). */
  recheckAt?: number;
  /** A moment the wait is FOR (a locktime), never a moment it began. */
  timestamp?: number;
}

/** What a row says once its event has happened (past tense). */
export interface DoneCopy {
  label: string;
  info?: string;
  timestamp?: number;
}

/**
 * One EVENT in a flow, with the two tenses it is ever shown in.
 *
 * A timeline is every event that has happened plus exactly one slot for the
 * event being waited on. Nothing further ahead is previewed, which is what
 * makes the timeline add-only: a later state can finish the open slot and
 * open the next one, and a failure lands in the open slot, but no state can
 * take a row away.
 */
export interface MilestoneDef {
  /** Semantic step id, stable across states. Doubles as the rowKey. */
  id: string;
  /** Protocol-state token for logs and the debug readout. */
  state: string;
  /** Omit an event that cannot occur for this entry. Must not change over
   *  the life of an entry: a row that stops being included is a removed row. */
  included?(ctx: TimelineContext): boolean;
  /** MONOTONE "this event has happened". The engine takes the furthest done
   *  event, so out-of-order observations can only advance the flow. */
  done(ctx: TimelineContext): boolean;
  /** Present tense: the row while it is the open slot. */
  active(ctx: TimelineContext): ActiveCopy;
  /** Past tense: the row once the event has happened. */
  completed(ctx: TimelineContext): DoneCopy;
  /** Sole owner of the segmented confirmationRing flag. */
  ring?(ctx: TimelineContext): boolean;
}

/** The row a terminal outcome puts in the open slot. */
export interface OutcomeRow {
  state: string;
  label: string;
  stepType: TimelineStepType;
  info?: string;
  timestamp?: number;
}

export interface OutcomeDef {
  /** Terminal step id (e.g. 'expired', 'rolled-back', 'settled-offchain'). */
  id: string;
  kind: Exclude<TimelineOutcomeKind, "pending" | "empty">;
  when(ctx: TimelineContext): boolean;
  /**
   * Id of the furthest event the entry itself proves happened before the
   * outcome. A terminal state usually erases how far the flow got (`rolled_back`
   * does not say from where), so this reads whatever evidence survives.
   */
  doneThrough?(ctx: TimelineContext): string | null;
  row(ctx: TimelineContext): OutcomeRow;
}

export interface FlowDef {
  variant: TimelineFlowVariant;
  /** False for a state this flow does not understand: the model is empty
   *  rather than a guess. Defaults to always known. */
  known?(ctx: TimelineContext): boolean;
  /** The flow is being reversed but has not finished reversing. */
  reversing?(ctx: TimelineContext): boolean;
  /** Checked in order before the open slot is drawn; first match wins. */
  outcomes: OutcomeDef[];
  milestones: MilestoneDef[];
}
