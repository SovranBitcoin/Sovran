/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * history/normalize.ts — coco v2 → legacy read-model normalization
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * coco v2 projects history entries with operation-family states
 * (prepared/finalized/rolled_back/…) and an `amount` that is an Amount OBJECT
 * ({ toNumber() }), not a plain number. Consumers (buildTimeline, and the
 * screen-actions preview matcher `shouldApplyEntryUpdate`) speak the legacy
 * vocabulary and compare amounts by strict numeric equality. If a raw coco
 * entry reaches them un-normalized, the amount comparison silently fails and
 * live timeline updates get dropped — which is exactly the "toast fires but the
 * timeline never advances" regression these tests guard against.
 */

import { describe, it, expect } from "vitest";

import {
  normalizeHistoryEntries,
  normalizeHistoryEntry,
  normalizeHistoryEntryState,
  serializeHistoryEntry,
} from "../../src/history/normalize";
import type { HistoryEntry } from "@cashu/coco-core";

const meltEntry = (state: string, amount: unknown): HistoryEntry =>
  ({
    id: "melt:abc",
    type: "melt",
    state,
    amount,
    mintUrl: "https://mint.example",
    unit: "sat",
    quoteId: "q1",
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as HistoryEntry;

const mintEntry = (state: string, amount: unknown = 1): HistoryEntry =>
  ({
    id: "mint:abc",
    type: "mint",
    state,
    amount,
    mintUrl: "https://mint.example",
    unit: "sat",
    quoteId: "q1",
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as HistoryEntry;

describe("normalizeHistoryEntry — amount coercion", () => {
  it("coerces a coco Amount OBJECT to a plain number", () => {
    // The bug: a live coco entry carries amount as { toNumber() }. The preview
    // matcher's `ca === ua` compared 100 (number) to the object → never equal,
    // so every melt update was dropped and the timeline stuck at UNPAID.
    const entry = meltEntry("finalized", { toNumber: () => 100 });
    const normalized = normalizeHistoryEntry(entry);
    expect((normalized as { amount: unknown }).amount).toBe(100);
  });

  it("leaves an already-numeric amount as a number (and same reference)", () => {
    const entry = meltEntry("PAID", 100);
    const normalized = normalizeHistoryEntry(entry);
    expect((normalized as { amount: unknown }).amount).toBe(100);
    // Nothing changed (state already legacy, amount already numeric).
    expect(normalized).toBe(entry);
  });

  it("normalizes state AND amount together", () => {
    const entry = meltEntry("finalized", { toNumber: () => 42 });
    const normalized = normalizeHistoryEntry(entry);
    expect((normalized as { amount: unknown }).amount).toBe(42);
    // finalized melt → legacy PAID.
    expect((normalized as { state: string }).state).toBe("PAID");
  });

  it("is idempotent once state and amount are normalized", () => {
    const normalized = normalizeHistoryEntry(
      meltEntry("finalized", { toNumber: () => 42 }),
    );

    expect(normalizeHistoryEntry(normalized)).toBe(normalized);
  });
});

describe("normalizeHistoryEntryState — v2 → legacy vocabulary", () => {
  it.each([
    ["pending", "UNPAID"],
    ["executing", "PAID"],
    ["finalized", "ISSUED"],
    ["failed", "UNPAID"],
  ])("maps raw mint state %s → %s", (state, expected) => {
    expect(
      (normalizeHistoryEntryState(mintEntry(state)) as { state: string }).state,
    ).toBe(expected);
  });

  it("passes an unknown mint state through by the same object reference", () => {
    const entry = mintEntry("future-mint-state");

    expect(normalizeHistoryEntryState(entry)).toBe(entry);
  });

  it("maps a rolled-back melt to the legacy rolledBack spelling", () => {
    const entry = meltEntry("rolled_back", 100);
    expect((normalizeHistoryEntryState(entry) as { state: string }).state).toBe(
      "rolledBack",
    );
  });

  it("maps finalized melt → PAID, prepared → UNPAID", () => {
    expect(
      (
        normalizeHistoryEntryState(meltEntry("finalized", 1)) as {
          state: string;
        }
      ).state,
    ).toBe("PAID");
    expect(
      (
        normalizeHistoryEntryState(meltEntry("prepared", 1)) as {
          state: string;
        }
      ).state,
    ).toBe("UNPAID");
  });
});

describe("serializeHistoryEntry", () => {
  it("serializes an object amount as a bare number and normalizes the state", () => {
    const serialized = serializeHistoryEntry(
      meltEntry("finalized", {
        toNumber: () => 21,
        toString: () => "21",
      }),
    );

    expect(JSON.parse(serialized)).toMatchObject({ amount: 21, state: "PAID" });
    expect(serialized).toContain('"amount":21');
    expect(serialized).not.toContain('"amount":"21"');
  });
});

describe("normalizeHistoryEntries — reference stability", () => {
  it("keeps the same array when no entry changes", () => {
    const entries = [meltEntry("PAID", 21)];

    expect(normalizeHistoryEntries(entries)).toBe(entries);
  });

  it("returns a new array when any state changes, then becomes idempotent", () => {
    const entries = [meltEntry("finalized", 21), meltEntry("PAID", 8)];
    const normalized = normalizeHistoryEntries(entries);

    expect(normalized).not.toBe(entries);
    expect(normalized[0]).not.toBe(entries[0]);
    expect(normalized[1]).toBe(entries[1]);
    expect((normalized[0] as { state: string }).state).toBe("PAID");
    expect(normalizeHistoryEntries(normalized)).toBe(normalized);
  });
});
