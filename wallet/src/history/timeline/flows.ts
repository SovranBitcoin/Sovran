// ---------------------------------------------------------------------------
// Flow definitions — pure data
// ---------------------------------------------------------------------------
//
// One FlowDef per flow variant: an ordered milestone list plus the terminal
// outcomes that displace the tail of the timeline. `reached` predicates are
// MONOTONE over the resolved state — the engine takes the max reached index,
// which is what makes milestone-skipping subtleties (e.g. onchain melt "Paid
// is complete if ANY later milestone reached") fall out for free.
//
// Copy resolution stays on the PaymentCopyResolver groups (ctx.copy); every
// label/info/timestamp branch reproduces the old switch field-for-field.

import { MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";
import type { MintHistoryEntry } from "@cashu/coco-core";

import { isTerminalFailureState } from "../states";
import {
  EXPIRED_STATE,
  FAILED_STATE,
  getOnchainConfirmationInfo,
  meltQuoteExpired,
  mintHistoryEntryExpired,
  onchainPaidStepType,
} from "./context";
import type {
  FlowDef,
  MilestoneDef,
  OutcomeDef,
  OutcomeRow,
  TimelineContext,
  TimelineFlowVariant,
} from "./types";

// ---------------------------------------------------------------------------
// Mint (lightning + onchain deposit)
// ---------------------------------------------------------------------------

function makeMintFlow(onchain: boolean): FlowDef {
  const known = (ctx: TimelineContext) =>
    ctx.mintState === MintQuoteState.UNPAID ||
    ctx.mintState === MintQuoteState.PAID ||
    ctx.mintState === MintQuoteState.ISSUED;
  // "Payment received" = the MINT credited the quote — except for onchain
  // deposits, where an observed (still-confirming) deposit advances the flow
  // to the middle step without claiming the mint saw it (label differs).
  const paidReached = (ctx: TimelineContext) =>
    ctx.mintState === MintQuoteState.PAID ||
    ctx.mintState === MintQuoteState.ISSUED ||
    (onchain && !!ctx.progress?.hasPayment);
  const issuedReached = (ctx: TimelineContext) =>
    ctx.mintState === MintQuoteState.ISSUED;

  const milestones: MilestoneDef[] = [
    {
      id: "requested",
      reached: known,
      activeStyle: () => "next-pending",
      copy: (ctx) => {
        const { MINT_COPY } = ctx.copy;
        if (paidReached(ctx)) {
          return {
            state: MintQuoteState.UNPAID,
            label: MINT_COPY.UNPAID.label,
            timestamp: ctx.createdAt,
          };
        }
        return {
          state: MintQuoteState.UNPAID,
          label: MINT_COPY.UNPAID.label,
          info: onchain ? MINT_COPY.UNPAID.onchainInfo : MINT_COPY.UNPAID.info,
        };
      },
    },
    {
      id: "paid",
      reached: paidReached,
      activeStyle: (ctx) =>
        onchain ? onchainPaidStepType(ctx.progress) : "next-pending",
      copy: (ctx) => {
        const { MINT_COPY } = ctx.copy;
        if (issuedReached(ctx)) {
          return {
            state: MintQuoteState.PAID,
            label: MINT_COPY.PAID.label,
            timestamp: ctx.createdAt,
          };
        }
        if (!paidReached(ctx)) {
          return { state: MintQuoteState.PAID, label: MINT_COPY.PAID.label };
        }
        const progress = ctx.progress;
        if (
          onchain &&
          ctx.mintState === MintQuoteState.UNPAID &&
          progress?.hasPayment
        ) {
          // The deposit is visible on-chain (our own explorer), but the mint
          // has NOT credited the quote yet (state still UNPAID). Do not claim
          // "Payment received" here — that milestone is the mint marking the
          // quote PAID. Until then the middle step reports the on-chain
          // confirmation phase and, once confirmations are satisfied, that
          // we're waiting on the mint to credit.
          const satisfied = progress.isSatisfied;
          return {
            state: MintQuoteState.PAID,
            label: satisfied
              ? ctx.paymentCopy.text("timeline.onchain.confirmedLabel")
              : ctx.paymentCopy.text("timeline.onchain.confirmingLabel"),
            info: satisfied
              ? ctx.paymentCopy.text("timeline.onchain.waitingForMint")
              : getOnchainConfirmationInfo(progress, ctx.paymentCopy),
          };
        }
        return {
          state: MintQuoteState.PAID,
          label: MINT_COPY.PAID.label,
          info:
            onchain && progress
              ? getOnchainConfirmationInfo(progress, ctx.paymentCopy)
              : MINT_COPY.PAID.info,
        };
      },
    },
    {
      id: "issued",
      reached: issuedReached,
      copy: (ctx) => {
        const { MINT_COPY } = ctx.copy;
        if (issuedReached(ctx)) {
          return {
            state: MintQuoteState.ISSUED,
            label: MINT_COPY.ISSUED.label,
            info: MINT_COPY.ISSUED.info(ctx.amount),
          };
        }
        return { state: MintQuoteState.ISSUED, label: MINT_COPY.ISSUED.label };
      },
    },
  ];

  const requestedComplete = (ctx: TimelineContext): OutcomeRow => ({
    slot: "requested",
    state: MintQuoteState.UNPAID,
    label: ctx.copy.MINT_COPY.UNPAID.label,
    stepType: "complete",
    timestamp: ctx.createdAt,
  });

  const outcomes: OutcomeDef[] = [
    {
      id: "expired",
      kind: "expired",
      // Expiry only ever applies to a still-UNPAID Lightning invoice; onchain
      // deposit addresses do not expire.
      when: (ctx) =>
        !onchain &&
        ctx.mintState === MintQuoteState.UNPAID &&
        mintHistoryEntryExpired(
          ctx.entry as Extract<typeof ctx.entry, { type: "mint" }>,
        ),
      rows: (ctx) => [
        requestedComplete(ctx),
        {
          slot: "paid",
          id: "expired",
          state: EXPIRED_STATE,
          label: ctx.copy.MINT_COPY.expired.label,
          stepType: "expired",
          info: ctx.copy.MINT_COPY.expired.info,
        },
      ],
    },
    {
      id: "failed",
      kind: "failed",
      when: (ctx) => ctx.mintState === FAILED_STATE,
      rows: (ctx) => [
        requestedComplete(ctx),
        {
          slot: "paid",
          id: "failed",
          state: FAILED_STATE,
          label: ctx.copy.MINT_COPY.failed.label,
          stepType: "expired",
          info:
            (ctx.entry as MintHistoryEntry & { error?: string }).error ??
            ctx.copy.MINT_COPY.failed.info,
        },
      ],
    },
  ];

  return {
    variant: onchain ? "onchain-mint" : "lightning-mint",
    outcomes,
    milestones,
  };
}

// ---------------------------------------------------------------------------
// Melt (lightning send)
// ---------------------------------------------------------------------------

// A failed/reversed melt returns the ecash to the balance. coco v2 spells
// this `rolled_back`/`rolling_back`/`failed` (normalized to `rolledBack`);
// without this the state falls to the UNPAID default and a cancelled send
// renders as if it were still waiting to be sent. Both melt variants render
// the SAME rows (the old switch short-circuited before the onchain branch);
// only the rowKey slots map onto each variant's own milestone list.
const meltRolledBackOutcome = (slots: {
  kept: string;
  terminal: string;
}): OutcomeDef => ({
  id: "rolled-back",
  kind: "rolled-back",
  when: (ctx) => isTerminalFailureState(ctx.state),
  rows: (ctx) => [
    {
      slot: slots.kept,
      state: MeltQuoteState.PENDING,
      label: ctx.copy.MELT_COPY.PENDING.label,
      stepType: "complete",
      timestamp: ctx.createdAt,
    },
    {
      slot: slots.terminal,
      id: "rolled-back",
      state: "rolledBack",
      label: ctx.copy.MELT_COPY.rolledBack.label,
      stepType: "rolled-back",
      info: ctx.copy.MELT_COPY.rolledBack.info,
    },
  ],
});

// Expiry only ever applies from a still-UNPAID quote.
const meltExpiredOutcome = (slots: {
  kept: string;
  terminal: string;
}): OutcomeDef => ({
  id: "expired",
  kind: "expired",
  when: (ctx) =>
    !!ctx.meltQuote &&
    ctx.meltState === MeltQuoteState.UNPAID &&
    meltQuoteExpired(ctx.meltQuote, ctx.currentTime),
  rows: (ctx) => [
    {
      slot: slots.kept,
      state: MeltQuoteState.UNPAID,
      label: ctx.copy.MELT_COPY.UNPAID.label,
      stepType: "complete",
      timestamp: ctx.createdAt,
    },
    {
      slot: slots.terminal,
      id: "expired",
      state: EXPIRED_STATE,
      label: ctx.copy.MELT_COPY.expired.label,
      stepType: "expired",
      info: ctx.copy.MELT_COPY.expired.info,
    },
  ],
});

const lightningMeltFlow: FlowDef = {
  variant: "lightning-melt",
  outcomes: [
    meltRolledBackOutcome({ kept: "pending", terminal: "paid" }),
    meltExpiredOutcome({ kept: "unpaid", terminal: "pending" }),
  ],
  milestones: [
    {
      id: "unpaid",
      reached: () => true,
      activeStyle: () => "next-pending",
      copy: (ctx) => {
        const { MELT_COPY } = ctx.copy;
        if (ctx.meltState !== MeltQuoteState.UNPAID) {
          return {
            state: MeltQuoteState.UNPAID,
            label: MELT_COPY.UNPAID.label,
            timestamp: ctx.createdAt,
          };
        }
        return {
          state: MeltQuoteState.UNPAID,
          label: MELT_COPY.UNPAID.label,
          info: MELT_COPY.UNPAID.info,
        };
      },
    },
    {
      id: "pending",
      reached: (ctx) =>
        ctx.meltState === MeltQuoteState.PENDING ||
        ctx.meltState === MeltQuoteState.PAID,
      activeStyle: () => "current",
      copy: (ctx) => {
        const { MELT_COPY } = ctx.copy;
        if (ctx.meltState === MeltQuoteState.PAID) {
          return {
            state: MeltQuoteState.PENDING,
            label: MELT_COPY.PENDING.label,
            timestamp: ctx.createdAt,
          };
        }
        if (ctx.meltState === MeltQuoteState.PENDING) {
          return {
            state: MeltQuoteState.PENDING,
            label: MELT_COPY.PENDING.label,
            info: MELT_COPY.PENDING.info,
          };
        }
        return { state: MeltQuoteState.PENDING, label: MELT_COPY.PENDING.label };
      },
    },
    {
      id: "paid",
      reached: (ctx) => ctx.meltState === MeltQuoteState.PAID,
      copy: (ctx) => {
        const { MELT_COPY } = ctx.copy;
        if (ctx.meltState === MeltQuoteState.PAID) {
          return {
            state: MeltQuoteState.PAID,
            label: MELT_COPY.PAID.label,
            info: MELT_COPY.PAID.info,
          };
        }
        return { state: MeltQuoteState.PAID, label: MELT_COPY.PAID.label };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Onchain melt (NUT-30 send)
// ---------------------------------------------------------------------------
//
// Three milestones: "Paid" (ecash spent) → the bitcoin network phase
// ("Broadcasting…" then "In mempool · N/6 blocks" with the segmented
// confirmation ring) → "Confirmed". If the mint settles off-chain (PAID, no
// outpoint) the network phase collapses to a single "Settled off-chain" row —
// the shared "Paid" row keeps its identity so the 3→2 change fades smoothly.

// The tx is in the mempool once the confirmation watcher sees it; before that
// the mint is still broadcasting.
const onchainBroadcast = (ctx: TimelineContext) => !!ctx.progress?.hasPayment;
const onchainConfirmed = (ctx: TimelineContext) => !!ctx.progress?.isSatisfied;
// "Paid" = the ecash has left the wallet. That is true past UNPAID, but ALSO
// whenever a later milestone has been reached — a broadcast tx, an on-chain
// confirmation, or an off-chain settlement. Keying only on the melt-state
// string let "Paid" render as still-pending under a completed terminal when a
// mint reported a settled state the mapping didn't recognise (e.g. the
// cdk-ldk-bdk off-chain settle): a grey idle "Paid" above a green "Settled
// off-chain". Deriving it from "have we reached a later step" makes that
// impossible.
const onchainPaid = (ctx: TimelineContext) =>
  ctx.meltState === MeltQuoteState.PENDING ||
  ctx.meltState === MeltQuoteState.PAID ||
  onchainBroadcast(ctx) ||
  onchainConfirmed(ctx) ||
  !!ctx.onchainSettledInternally;

const onchainMeltFlow: FlowDef = {
  variant: "onchain-melt",
  outcomes: [
    meltRolledBackOutcome({ kept: "network", terminal: "confirmed" }),
    meltExpiredOutcome({ kept: "paid", terminal: "network" }),
    // Off-chain settlement: PAID with no outpoint — the mint paid without a
    // transaction, so there is no network phase to show. The terminal row
    // shares the 'network' slot's rowKey (it collapses that phase in place).
    {
      id: "settled-offchain",
      kind: "settled",
      when: (ctx) => !!ctx.onchainSettledInternally,
      rows: (ctx) => [
        {
          slot: "paid",
          state: MeltQuoteState.UNPAID,
          label: ctx.copy.MELT_COPY.onchain.paid.label,
          stepType: "complete",
          timestamp: ctx.createdAt,
        },
        {
          slot: "network",
          id: "settled-offchain",
          state: MeltQuoteState.PAID,
          label: ctx.copy.MELT_COPY.onchain.offchain.label,
          stepType: "success",
          info: ctx.copy.MELT_COPY.onchain.offchain.info,
          timestamp: ctx.createdAt,
        },
      ],
    },
  ],
  milestones: [
    {
      id: "paid",
      reached: () => true,
      activeStyle: () => "next-pending",
      copy: (ctx) => {
        const { MELT_COPY } = ctx.copy;
        if (onchainPaid(ctx)) {
          return {
            state: MeltQuoteState.UNPAID,
            label: MELT_COPY.onchain.paid.label,
            timestamp: ctx.createdAt,
          };
        }
        return {
          state: MeltQuoteState.UNPAID,
          label: MELT_COPY.onchain.paid.label,
        };
      },
    },
    {
      id: "network",
      reached: onchainPaid,
      activeStyle: () => "current",
      ring: (ctx) => onchainBroadcast(ctx) && !!ctx.progress,
      copy: (ctx) => {
        const { MELT_COPY } = ctx.copy;
        const progress = ctx.progress;
        if (onchainBroadcast(ctx) && progress) {
          return {
            state: MeltQuoteState.PENDING,
            label: MELT_COPY.onchain.mempool.label,
            info: ctx.paymentCopy.text("timeline.melt.onchain.blocks", {
              current: String(progress.currentConfirmations ?? 0),
              required: String(progress.requiredConfirmations),
            }),
            ...(onchainConfirmed(ctx) ? { timestamp: ctx.createdAt } : {}),
          };
        }
        return {
          state: MeltQuoteState.PENDING,
          label: MELT_COPY.onchain.broadcasting.label,
          info: MELT_COPY.onchain.broadcasting.info,
        };
      },
    },
    {
      id: "confirmed",
      reached: onchainConfirmed,
      copy: (ctx) => {
        const { MELT_COPY } = ctx.copy;
        if (onchainConfirmed(ctx)) {
          return {
            state: MeltQuoteState.PAID,
            label: MELT_COPY.onchain.confirmed.label,
            timestamp: ctx.createdAt,
          };
        }
        return {
          state: MeltQuoteState.PAID,
          label: MELT_COPY.onchain.confirmed.label,
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Send (bearer ecash)
// ---------------------------------------------------------------------------

const sendKnown = (ctx: TimelineContext) =>
  ctx.state === "prepared" || ctx.state === "pending" || ctx.state === "finalized";

const sendFlow: FlowDef = {
  variant: "send",
  outcomes: [
    {
      id: "rolled-back",
      kind: "rolled-back",
      when: (ctx) => ctx.state === "rolledBack" || ctx.state === "rolled_back",
      rows: (ctx) => [
        {
          slot: "prepared",
          state: "prepared",
          label: ctx.copy.SEND_COPY.prepared.label,
          stepType: "complete",
          timestamp: ctx.createdAt,
        },
        {
          slot: "pending",
          id: "rolled-back",
          state: "rolledBack",
          label: ctx.copy.SEND_COPY.rolledBack.label,
          stepType: "rolled-back",
          info: ctx.copy.SEND_COPY.rolledBack.info,
        },
      ],
    },
  ],
  milestones: [
    {
      id: "prepared",
      reached: sendKnown,
      activeStyle: () => "current",
      copy: (ctx) => {
        const { SEND_COPY } = ctx.copy;
        if (ctx.state === "prepared") {
          return {
            state: "prepared",
            label: SEND_COPY.prepared.label,
            info: SEND_COPY.prepared.info,
          };
        }
        return {
          state: "prepared",
          label: SEND_COPY.prepared.label,
          timestamp: ctx.createdAt,
        };
      },
    },
    {
      id: "pending",
      reached: (ctx) => ctx.state === "pending" || ctx.state === "finalized",
      activeStyle: () => "next-pending",
      // A freshly-prepared send already previews the "Sent" step as the
      // (bare) next step rather than a small future dot.
      upcomingStyle: () => "next-pending",
      copy: (ctx) => {
        const { SEND_COPY } = ctx.copy;
        if (ctx.state === "finalized") {
          return {
            state: "pending",
            label: SEND_COPY.pending.label,
            timestamp: ctx.createdAt,
          };
        }
        if (ctx.state === "pending") {
          return {
            state: "pending",
            label: SEND_COPY.pending.label,
            info: SEND_COPY.pending.info,
          };
        }
        return { state: "pending", label: SEND_COPY.pending.label };
      },
    },
    {
      id: "finalized",
      reached: (ctx) => ctx.state === "finalized",
      copy: (ctx) => {
        const { SEND_COPY } = ctx.copy;
        if (ctx.state === "finalized") {
          return {
            state: "finalized",
            label: SEND_COPY.finalized.label,
            info: SEND_COPY.finalized.info,
          };
        }
        return { state: "finalized", label: SEND_COPY.finalized.label };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Payment-request send (outgoing "pay this request" ecash)
// ---------------------------------------------------------------------------

// Delivery over nostr happened (the milestone is complete) once the caller
// reports nostrSent; the claim milestone becomes the active waiting step.
const prSendDelivered = (ctx: TimelineContext) =>
  ctx.state === "finalized" || (ctx.state === "pending" && !!ctx.nostrSent);

const paymentRequestSendFlow: FlowDef = {
  variant: "payment-request-send",
  outcomes: [
    {
      id: "rolled-back",
      kind: "rolled-back",
      when: (ctx) => ctx.state === "rolledBack" || ctx.state === "rolled_back",
      rows: (ctx) => {
        const { PAYMENT_REQUEST_COPY } = ctx.copy;
        const rows: OutcomeRow[] = [
          {
            slot: "prepared",
            state: "prepared",
            label: PAYMENT_REQUEST_COPY.prepared.label,
            stepType: "complete",
            timestamp: ctx.createdAt,
          },
        ];
        if (ctx.nostrSent) {
          rows.push({
            slot: "nostr-sent",
            state: "nostrSent",
            label: PAYMENT_REQUEST_COPY.nostrSent.label,
            stepType: "complete",
            timestamp: ctx.createdAt,
          });
        }
        rows.push({
          slot: ctx.nostrSent ? "finalized" : "nostr-sent",
          id: "rolled-back",
          state: "rolledBack",
          label: PAYMENT_REQUEST_COPY.rolledBack.label,
          stepType: "rolled-back",
          info: PAYMENT_REQUEST_COPY.rolledBack.info,
        });
        return rows;
      },
    },
  ],
  milestones: [
    {
      id: "prepared",
      reached: sendKnown,
      activeStyle: (ctx) => (ctx.tokenCreated ? "complete" : "next-pending"),
      copy: (ctx) => {
        const { PAYMENT_REQUEST_COPY } = ctx.copy;
        if (ctx.state === "prepared") {
          return {
            state: "prepared",
            label: PAYMENT_REQUEST_COPY.prepared.label,
            info: PAYMENT_REQUEST_COPY.prepared.info,
            ...(ctx.tokenCreated ? { timestamp: ctx.createdAt } : {}),
          };
        }
        return {
          state: "prepared",
          label: PAYMENT_REQUEST_COPY.prepared.label,
          timestamp: ctx.createdAt,
        };
      },
    },
    {
      id: "nostr-sent",
      reached: (ctx) => ctx.state === "pending" || ctx.state === "finalized",
      activeStyle: () => "next-pending",
      copy: (ctx) => {
        const { PAYMENT_REQUEST_COPY } = ctx.copy;
        if (prSendDelivered(ctx)) {
          return {
            state: "nostrSent",
            label: PAYMENT_REQUEST_COPY.nostrSent.label,
            timestamp: ctx.createdAt,
            info: PAYMENT_REQUEST_COPY.nostrSent.infoSent,
          };
        }
        if (ctx.state === "pending") {
          return {
            state: "nostrSent",
            label: PAYMENT_REQUEST_COPY.nostrSent.label,
            info: PAYMENT_REQUEST_COPY.nostrSent.infoSending,
          };
        }
        return {
          state: "nostrSent",
          label: PAYMENT_REQUEST_COPY.nostrSent.label,
        };
      },
    },
    {
      id: "finalized",
      reached: prSendDelivered,
      activeStyle: (ctx) =>
        ctx.state === "finalized" ? "success" : "next-pending",
      copy: (ctx) => {
        const { PAYMENT_REQUEST_COPY, SEND_COPY } = ctx.copy;
        if (ctx.state === "finalized") {
          return {
            state: "finalized",
            label: PAYMENT_REQUEST_COPY.finalized.label,
            info: PAYMENT_REQUEST_COPY.finalized.info,
          };
        }
        if (prSendDelivered(ctx)) {
          return {
            state: "finalized",
            label: PAYMENT_REQUEST_COPY.finalized.label,
            info: SEND_COPY.pending.info,
          };
        }
        return {
          state: "finalized",
          label: PAYMENT_REQUEST_COPY.finalized.label,
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Receive (token redemption)
// ---------------------------------------------------------------------------

const receiveFlow: FlowDef = {
  variant: "receive",
  outcomes: [
    {
      id: "already-spent",
      kind: "already-spent",
      when: (ctx) => ctx.state === "rolledBack" || ctx.state === "rolled_back",
      rows: (ctx) => [
        {
          slot: "pending",
          state: "pending",
          label: ctx.copy.RECEIVE_COPY.pending.label,
          stepType: "complete",
          timestamp: ctx.createdAt,
        },
        {
          slot: "redeemed",
          id: "already-spent",
          state: "alreadySpent",
          label: ctx.copy.RECEIVE_COPY.alreadySpent.label,
          stepType: "already-spent",
          info: ctx.copy.RECEIVE_COPY.alreadySpent.info,
        },
      ],
    },
  ],
  milestones: [
    {
      id: "pending",
      reached: () => true,
      activeStyle: () => "next-pending",
      copy: (ctx) => {
        const { RECEIVE_COPY } = ctx.copy;
        if (ctx.state === "prepared") {
          return {
            state: "pending",
            label: RECEIVE_COPY.pending.label,
            info: RECEIVE_COPY.pending.info,
          };
        }
        return {
          state: "pending",
          label: RECEIVE_COPY.pending.label,
          timestamp: ctx.createdAt,
        };
      },
    },
    {
      id: "redeemed",
      // Any non-prepared state (finalized or otherwise) renders the settled
      // arm — the old switch's catch-all default.
      reached: (ctx) => ctx.state !== "prepared",
      copy: (ctx) => {
        const { RECEIVE_COPY } = ctx.copy;
        if (ctx.state !== "prepared") {
          return {
            state: "redeemed",
            label: RECEIVE_COPY.redeemed.label,
            info: RECEIVE_COPY.redeemed.info(ctx.amount),
          };
        }
        return { state: "redeemed", label: RECEIVE_COPY.redeemed.label };
      },
    },
  ],
};

// A receive stuck in `executing` is a received-but-not-yet-redeemed token
// (e.g. accepted while the mint was unreachable): a fixed three-row waiting
// timeline.
const receiveRecoveryFlow: FlowDef = {
  variant: "receive-recovery",
  outcomes: [],
  milestones: [
    {
      id: "accepted",
      reached: () => true,
      copy: (ctx) => ({
        state: "accepted",
        label: ctx.copy.RECEIVE_COPY.accepted.label,
        timestamp: ctx.createdAt,
      }),
    },
    {
      id: "waiting",
      reached: () => true,
      activeStyle: () => "waiting",
      copy: (ctx) => ({
        state: "executing",
        label: ctx.copy.RECEIVE_COPY.waiting.label,
        info: ctx.copy.RECEIVE_COPY.waiting.info,
      }),
    },
    {
      id: "redeemed",
      reached: () => false,
      copy: (ctx) => ({
        state: "redeemed",
        label: ctx.copy.RECEIVE_COPY.redeemed.label,
      }),
    },
  ],
};

// ---------------------------------------------------------------------------
// Payment-request receive (incoming "Fixed Amount → as Ecash")
// ---------------------------------------------------------------------------
//
// A distinct milestone timeline that leads with "waiting for payment on
// nostr" — the step a normal token receive lacks. The list pending row is
// `state:executing` + paymentRequestPending — it must ALWAYS read "waiting
// for payment", never the generic "redeeming", so the pending flag pins the
// flow to the first milestone regardless of state.

const prReceivePaid = (ctx: TimelineContext) => !ctx.prPendingFlag;
const prReceiveAdded = (ctx: TimelineContext) =>
  !ctx.prPendingFlag && ctx.state === "finalized";

const paymentRequestReceiveFlow: FlowDef = {
  variant: "payment-request-receive",
  outcomes: [
    {
      id: "already-spent",
      kind: "already-spent",
      when: (ctx) =>
        !ctx.prPendingFlag &&
        (ctx.state === "rolledBack" || ctx.state === "rolled_back"),
      rows: (ctx) => [
        {
          slot: "requested",
          state: "requested",
          label: ctx.copy.RECEIVE_COPY.paymentRequest.requested.label,
          stepType: "complete",
          timestamp: ctx.createdAt,
        },
        {
          slot: "paid",
          id: "already-spent",
          state: "alreadySpent",
          label: ctx.copy.RECEIVE_COPY.alreadySpent.label,
          stepType: "already-spent",
          info: ctx.copy.RECEIVE_COPY.alreadySpent.info,
        },
      ],
    },
  ],
  milestones: [
    {
      id: "requested",
      reached: () => true,
      activeStyle: () => "next-pending",
      copy: (ctx) => {
        const PR = ctx.copy.RECEIVE_COPY.paymentRequest;
        if (prReceivePaid(ctx)) {
          return {
            state: "requested",
            label: PR.requested.label,
            timestamp: ctx.createdAt,
          };
        }
        return {
          state: "requested",
          label: PR.requested.label,
          info: PR.requested.info,
        };
      },
    },
    {
      id: "paid",
      reached: prReceivePaid,
      activeStyle: () => "current",
      copy: (ctx) => {
        const PR = ctx.copy.RECEIVE_COPY.paymentRequest;
        if (prReceiveAdded(ctx)) {
          return {
            state: "paid",
            label: PR.paid.label,
            timestamp: ctx.createdAt,
          };
        }
        if (prReceivePaid(ctx)) {
          // prepared / executing: the payer paid, the claim is running.
          return { state: "paid", label: PR.paid.label, info: PR.paid.info };
        }
        return { state: "paid", label: PR.paid.label };
      },
    },
    {
      id: "added",
      reached: prReceiveAdded,
      copy: (ctx) => {
        const { RECEIVE_COPY } = ctx.copy;
        if (prReceiveAdded(ctx)) {
          return {
            state: "added",
            label: RECEIVE_COPY.redeemed.label,
            info: RECEIVE_COPY.redeemed.info(ctx.amount),
          };
        }
        return { state: "added", label: RECEIVE_COPY.redeemed.label };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TIMELINE_FLOWS: Partial<Record<TimelineFlowVariant, FlowDef>> = {
  "lightning-mint": makeMintFlow(false),
  "onchain-mint": makeMintFlow(true),
  "lightning-melt": lightningMeltFlow,
  "onchain-melt": onchainMeltFlow,
  send: sendFlow,
  "payment-request-send": paymentRequestSendFlow,
  receive: receiveFlow,
  "receive-recovery": receiveRecoveryFlow,
  "payment-request-receive": paymentRequestReceiveFlow,
};
