/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 *
 * One AI request is a send and a receive that mean one thing. The outcome
 * these must keep apart is refund vs cancellation: a failed request whose
 * money came back is NOT a rollback, and calling it one tells the user their
 * payment never happened when it did.
 */
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@cashu/coco-core";

import { encodeAnnotation, type TransactionAnnotation } from "../../src/annotations";
import { groupAiRequests, isAiRequestLeg } from "../../src/history";

function leg(
  partial: {
    id: string;
    type: string;
    state?: string;
    amount?: number;
    unit?: string;
    createdAt?: number;
  },
  ai?: TransactionAnnotation["ai"],
): HistoryEntry {
  return {
    createdAt: 0,
    amount: 0,
    unit: "sat",
    ...partial,
    ...(ai ? { metadata: encodeAnnotation({ ai }) } : {}),
  } as unknown as HistoryEntry;
}

const GROUP = "ai-1";
const payment = (over: Partial<Parameters<typeof leg>[0]> = {}) =>
  leg(
    { id: "send-1", type: "send", state: "finalized", amount: 100, createdAt: 10, ...over },
    { groupId: GROUP, role: "payment", model: "claude-opus-5", messageId: "m-1" },
  );
const change = (over: Partial<Parameters<typeof leg>[0]> = {}) =>
  leg(
    { id: "recv-1", type: "receive", state: "finalized", amount: 100, createdAt: 12, ...over },
    { groupId: GROUP, role: "change" },
  );

describe("groupAiRequests", () => {
  it("ignores entries that carry no AI annotation", () => {
    expect(groupAiRequests([leg({ id: "x", type: "send", state: "finalized" })])).toEqual([]);
    expect(isAiRequestLeg(leg({ id: "x", type: "send" }))).toBe(false);
    expect(isAiRequestLeg(payment())).toBe(true);
  });

  it("reports a full refund as refunded, not cancelled", () => {
    const [group] = groupAiRequests([payment(), change()]);
    expect(group).toMatchObject({
      groupId: GROUP,
      state: "refunded",
      paidAmount: 100,
      refundedAmount: 100,
      netAmount: 0,
      model: "claude-opus-5",
    });
    // Payment first, so the row can read the request off leg zero.
    expect(group?.legs.map((l) => l.id)).toEqual(["send-1", "recv-1"]);
    // Ranked by the LAST thing that happened, not the first.
    expect(group?.createdAt).toBe(12);
  });

  it("reports partial change as what the answer cost", () => {
    const [group] = groupAiRequests([payment(), change({ amount: 70 })]);
    expect(group).toMatchObject({ state: "spent", netAmount: 30, refundedAmount: 70 });
  });

  it("reports a request with no change at all as fully spent", () => {
    const [group] = groupAiRequests([payment()]);
    expect(group).toMatchObject({ state: "spent", netAmount: 100, refundedAmount: 0 });
  });

  // The one outcome that really is a cancellation: the token never left.
  it.each(["rolledBack", "rolled_back"])(
    "reports a %s payment with no change as cancelled",
    (state) => {
      const [group] = groupAiRequests([payment({ state })]);
      expect(group).toMatchObject({ state: "cancelled", paidAmount: 0, netAmount: 0 });
    },
  );

  it("waits for an in-flight leg before deciding the outcome", () => {
    const [group] = groupAiRequests([payment({ state: "pending" }), change()]);
    expect(group?.state).toBe("pending");
  });

  // A change token that never redeemed is money we did not get back. Counting
  // it would show a refund that never landed.
  it("counts only change that actually redeemed", () => {
    const [group] = groupAiRequests([payment(), change({ state: "rolled_back" })]);
    expect(group).toMatchObject({ state: "spent", refundedAmount: 0, netAmount: 100 });
  });

  it("keeps separate requests apart, newest first", () => {
    const other = leg(
      { id: "send-2", type: "send", state: "finalized", amount: 5, createdAt: 99 },
      { groupId: "ai-2", role: "payment" },
    );
    expect(groupAiRequests([payment(), change(), other]).map((g) => g.groupId)).toEqual([
      "ai-2",
      GROUP,
    ]);
  });
});
