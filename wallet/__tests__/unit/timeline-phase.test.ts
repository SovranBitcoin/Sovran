import { describe, expect, it } from "vitest";

import { buildTimelineModel, timelinePhase } from "../../src/history";

const AT = 1_700_000_000_000;
const base = {
  mintUrl: "https://mint.example.com",
  unit: "sat",
  createdAt: AT,
  updatedAt: AT,
};

const melt = (state: string) =>
  ({
    ...base,
    id: "melt-op-1",
    type: "melt",
    state,
    amount: 5_000,
    quoteId: "mq-1",
  }) as never;
const send = (state: string) =>
  ({
    ...base,
    id: "send-op-1",
    operationId: "send-op-1",
    type: "send",
    state,
    amount: 100,
  }) as never;
const request = (state: string) =>
  ({
    ...base,
    id: "send-op-2",
    operationId: "send-op-2",
    type: "send",
    state,
    amount: 100,
    metadata: { paymentRequest: "creqA", transportType: "nostr" },
  }) as never;
const mint = (state: string) =>
  ({
    ...base,
    id: "mint-op-1",
    type: "mint",
    state,
    amount: 21,
    quoteId: "q1",
    paymentRequest: "",
  }) as never;

const phaseOf = (input: Parameters<typeof buildTimelineModel>[0]) =>
  timelinePhase(buildTimelineModel(input));

describe("timelinePhase — the one word a toast may say about a timeline", () => {
  it("is working while the wallet itself is paying", () => {
    expect(
      phaseOf({ historyEntry: melt("pending"), currentTime: AT + 1_000 }),
    ).toBe("working");
  });

  it("turns slow at the moment the timeline says the payment is taking long", () => {
    const model = buildTimelineModel({
      historyEntry: melt("pending"),
      currentTime: AT + 1_000,
    });
    expect(model.recheckAt).toBeGreaterThan(AT);
    expect(
      phaseOf({
        historyEntry: melt("pending"),
        currentTime: model.recheckAt! - 1,
      }),
    ).toBe("working");
    expect(
      phaseOf({ historyEntry: melt("pending"), currentTime: model.recheckAt! }),
    ).toBe("slow");
  });

  it("is handed off once only the other side can act", () => {
    // A delivered payment request waits on the recipient.
    expect(
      phaseOf({
        historyEntry: request("pending"),
        currentTime: AT,
        tokenCreated: true,
        nostrSent: true,
      }),
    ).toBe("handed-off");
    // An unpaid invoice waits on the payer.
    expect(phaseOf({ historyEntry: mint("UNPAID"), currentTime: AT })).toBe(
      "handed-off",
    );
  });

  it("is done when settled and failed for every other ending", () => {
    expect(phaseOf({ historyEntry: melt("finalized"), currentTime: AT })).toBe(
      "done",
    );
    expect(phaseOf({ historyEntry: send("finalized"), currentTime: AT })).toBe(
      "done",
    );
    expect(
      phaseOf({ historyEntry: melt("rolled_back"), currentTime: AT }),
    ).toBe("failed");
    expect(phaseOf({ historyEntry: melt("failed"), currentTime: AT })).toBe(
      "failed",
    );
  });

  it("says nothing about an entry its flow does not understand", () => {
    expect(timelinePhase({ outcome: { kind: "empty" }, steps: [] })).toBeNull();
    expect(
      timelinePhase({ outcome: { kind: "pending" }, steps: [] }),
    ).toBeNull();
  });
});
