// ---------------------------------------------------------------------------
// Timeline model + flow-definition types
// ---------------------------------------------------------------------------
//
// The declarative flow engine (engine.ts) renders every payment flow from the
// same algorithm: a flow is an ordered list of MilestoneDef plus a list of
// terminal OutcomeDef (flows.ts). These are the shared vocabulary types.

import type { MeltQuoteBolt11Response } from "@cashu/cashu-ts";
import type { HistoryEntry } from "@cashu/coco-core";

import type {
  createPaymentCopyGroups,
  PaymentCopyResolver,
} from "../../copy";

export interface OnchainConfirmationProgress {
  hasPayment: boolean;
  hasUnconfirmedPayment: boolean;
  receivedSats: number;
  currentConfirmations: number | null;
  requiredConfirmations: number;
  isSatisfied: boolean;
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
}

export type TimelineFlowVariant =
  | "lightning-mint"
  | "onchain-mint"
  | "lightning-melt"
  | "onchain-melt"
  | "send"
  | "payment-request-send"
  | "receive"
  | "receive-recovery"
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
  /** Normalized mint timeline state (mint entries only). */
  mintState: string | null;
  /** Normalized melt timeline state (melt entries only). */
  meltState: string | null;
  /** Receive payment-request synthetic pending row flag. */
  prPendingFlag: boolean;
}

export interface MilestoneDef {
  /** Semantic step id, stable across states. Doubles as the default rowKey. */
  id: string;
  /** MONOTONE "the flow has arrived at (or passed) this milestone". The engine
   *  takes the max reached index as the active position. */
  reached(ctx: TimelineContext): boolean;
  /** Phase-appropriate row content. Owns info/timestamp presence exactly. */
  copy(ctx: TimelineContext): {
    label: string;
    info?: string;
    timestamp?: number;
    state: string;
  };
  /** stepType when this milestone is the active one. Defaults to 'success'
   *  on the last milestone and 'current' otherwise. */
  activeStyle?(ctx: TimelineContext): TimelineStepType;
  /** stepType when this milestone sits immediately above the active one
   *  (default 'future-small'). */
  upcomingStyle?(ctx: TimelineContext): TimelineStepType;
  /** Sole owner of the segmented confirmationRing flag. */
  ring?(ctx: TimelineContext): boolean;
}

/** One row of a terminal outcome. `slot` names the milestone whose rowKey the
 *  row inherits (kept milestones use their own id; the terminal step names the
 *  milestone slot it displaces). */
export interface OutcomeRow {
  slot: string;
  /** Step id; defaults to `slot` (kept milestone rows). */
  id?: string;
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
  rows(ctx: TimelineContext): OutcomeRow[];
}

export interface FlowDef {
  variant: TimelineFlowVariant;
  /** Checked in order BEFORE milestones; first match wins (mirrors the old
   *  switch's early returns). */
  outcomes: OutcomeDef[];
  milestones: MilestoneDef[];
}
