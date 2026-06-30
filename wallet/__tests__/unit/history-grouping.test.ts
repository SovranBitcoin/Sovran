import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@cashu/coco-core";

import {
  encodeAnnotation,
  type TransactionAnnotation,
} from "../../src/annotations";
import { groupTimeline } from "../../src/history";

function leg(
  partial: {
    id: string;
    type: string;
    state?: string;
    amount?: number;
    unit?: string;
    mintUrl?: string;
    createdAt?: number;
  },
  swap?: TransactionAnnotation["swap"],
): HistoryEntry {
  return {
    createdAt: 0,
    amount: 0,
    ...partial,
    ...(swap ? { metadata: encodeAnnotation({ swap }) } : {}),
  } as unknown as HistoryEntry;
}

describe("groupTimeline", () => {
  it("leaves un-annotated entries as plain bucketed items", () => {
    const items = groupTimeline([
      leg({ id: "r1", type: "receive", state: "finalized", createdAt: 5 }),
      leg({ id: "m1", type: "melt", state: "UNPAID", createdAt: 4 }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: "entry",
      bucket: "confirmed",
      createdAt: 5,
    });
    expect(items[1]).toMatchObject({
      kind: "entry",
      bucket: "pending",
      createdAt: 4,
    });
  });

  it("collapses a two-leg swap into one finished item, placed at the first leg", () => {
    const items = groupTimeline([
      leg({ id: "before", type: "receive", state: "finalized", createdAt: 9 }),
      leg(
        {
          id: "meltLeg",
          type: "melt",
          state: "PAID",
          amount: 480,
          createdAt: 10,
        },
        { groupId: "g1", role: "melt" },
      ),
      leg(
        {
          id: "mintLeg",
          type: "mint",
          state: "PAID",
          amount: 500,
          createdAt: 12,
        },
        { groupId: "g1", role: "mint" },
      ),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "entry", entry: { id: "before" } });
    const swap = items[1];
    expect(swap).toMatchObject({
      kind: "swap",
      groupId: "g1",
      state: "finished",
      bucket: "confirmed",
      amount: 500, // destination (mint-role) leg
      createdAt: 12, // newest leg
    });
    if (swap.kind === "swap") expect(swap.legs).toHaveLength(2);
  });

  it("marks a swap running when any leg is still pending", () => {
    const items = groupTimeline([
      leg(
        { id: "melt", type: "melt", state: "UNPAID", amount: 480 },
        { groupId: "g", role: "melt" },
      ),
      leg(
        { id: "mint", type: "mint", state: "PAID", amount: 500 },
        { groupId: "g", role: "mint" },
      ),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "swap",
      state: "running",
      bucket: "pending",
    });
  });

  it("marks a swap cancelled when a leg rolled back and nothing settled", () => {
    const items = groupTimeline([
      leg(
        { id: "melt", type: "melt", state: "rolled_back" },
        { groupId: "g", role: "melt" },
      ),
      leg(
        { id: "mint", type: "mint", state: "rolled_back" },
        { groupId: "g", role: "mint" },
      ),
    ]);
    expect(items[0]).toMatchObject({
      kind: "swap",
      state: "cancelled",
      bucket: "expired",
    });
  });

  it("orders multi-hop legs by hopIndex and derives the chain path", () => {
    const items = groupTimeline([
      leg(
        { id: "hop2", type: "mint", state: "PAID", amount: 500, mintUrl: "C" },
        { groupId: "g", role: "mint", chainId: "c1", hopIndex: 2 },
      ),
      leg(
        { id: "hop0", type: "melt", state: "PAID", mintUrl: "A" },
        { groupId: "g", role: "melt", chainId: "c1", hopIndex: 0 },
      ),
      leg(
        { id: "hop1", type: "melt", state: "PAID", mintUrl: "B" },
        { groupId: "g", role: "melt", chainId: "c1", hopIndex: 1 },
      ),
    ]);
    const swap = items[0];
    expect(swap.kind).toBe("swap");
    if (swap.kind === "swap") {
      expect(swap.legs.map((l) => l.id)).toEqual(["hop0", "hop1", "hop2"]);
      expect(swap.chainPath).toEqual(["A", "B", "C"]);
      expect(swap.amount).toBe(500);
    }
  });
});
