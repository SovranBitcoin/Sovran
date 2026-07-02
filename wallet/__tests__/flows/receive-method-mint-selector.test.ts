/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * receive-method-mint-selector.test.ts — receive-rail "Receiving with" picker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Bolt12/Onchain receive tabs each keep their own "Receiving with" mint
 * (like the npub.cash tab). The picker runs through the same machine lane as
 * the NPC selector — requestMintSelector with a method scope — so it inherits
 * the NPC guarantees:
 *
 *   1. Opens with clean context (a stale receive/send destination must never
 *      make the pick advance into the amount selector).
 *   2. The pick is persist-only: dismiss + onReceiveMethodMintChanged, never
 *      onPreferredMintChanged / onNpcMintChanged.
 *
 * Plus the rail-specific property: the selector carries the rail's method
 * requirement, so the list shows every trusted mint with the unsupported
 * ones DISABLED (capability reason) — the user sees which mints can actually
 * back the rail.
 */

import { describe, it, expect } from "vitest";

import { deriveMintMethodCapabilityMapFromTrustedMints } from "../../src/mint-capabilities";
import type { MintCandidate, StepDataMap } from "../../src";
import { createTestMachine } from "../_harness";
import { MINT1, MINT2 } from "../_harness/fixtures";

const BOLT11_ONLY_INFO = {
  nuts: {
    "4": { methods: [{ method: "bolt11", unit: "sat" }] },
    "5": { methods: [{ method: "bolt11", unit: "sat" }] },
  },
};

const REUSABLE_METHODS_INFO = {
  nuts: {
    "4": {
      methods: [
        { method: "bolt11", unit: "sat" },
        { method: "bolt12", unit: "sat" },
        { method: "onchain", unit: "sat" },
      ],
    },
    "5": { methods: [{ method: "bolt11", unit: "sat" }] },
  },
};

/** MINT1 is bolt11-only; MINT2 also mints bolt12 + onchain. */
function reusableWallet() {
  return {
    trustedMintUrls: [MINT1, MINT2],
    mintBalances: { [MINT1]: 1000, [MINT2]: 500 },
    mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
      { mintUrl: MINT1, mintInfo: BOLT11_ONLY_INFO },
      { mintUrl: MINT2, mintInfo: REUSABLE_METHODS_INFO },
    ]),
    preferredMintUrl: MINT1,
  };
}

function lastSelectMintData(tm: ReturnType<typeof createTestMachine>) {
  const call = tm.handlerCalls.filter((c) => c.step === "selectMint").at(-1);
  expect(call).toBeDefined();
  return call!.data as StepDataMap["selectMint"];
}

describe("receive-rail mint selector (bolt12 / onchain scopes)", () => {
  it("opens clean after Fixed Amount → back, carrying the bolt12 requirement", async () => {
    const tm = createTestMachine({ wallet: reusableWallet() });

    // Stale receive destination, exactly like the NPC regression.
    await tm.machine.startReceiveLightning({ reset: true });
    tm.assertStep("enterAmount");
    tm.assertContext({ destination: "mintQuote" });

    await tm.machine.requestMintSelector({ scope: "bolt12" });
    tm.assertStep("selectMint");
    expect(tm.machine.getContext().destination).toBeUndefined();

    const data = lastSelectMintData(tm);
    expect(data.scope).toBe("bolt12");
    expect(data.methodRequirement).toMatchObject({
      operation: "mint",
      method: "bolt12",
      unit: "sat",
    });
  });

  it("lists every trusted mint, disabling those that cannot back the rail", async () => {
    const tm = createTestMachine({ wallet: reusableWallet() });

    await tm.machine.requestMintSelector({ scope: "bolt12" });
    const candidates = lastSelectMintData(tm).candidates as MintCandidate[];

    expect(candidates.map((c) => c.mintUrl).sort()).toEqual(
      [MINT1, MINT2].sort(),
    );
    expect(candidates.find((c) => c.mintUrl === MINT1)?.status).toBe(
      "disabled",
    );
    expect(candidates.find((c) => c.mintUrl === MINT1)?.reason).toBeTruthy();
    expect(candidates.find((c) => c.mintUrl === MINT2)?.status).toBe(
      "available",
    );
  });

  it("bolt12 pick is persist-only: dismiss + onReceiveMethodMintChanged", async () => {
    const tm = createTestMachine({ wallet: reusableWallet() });

    await tm.machine.requestMintSelector({ scope: "bolt12" });
    await tm.machine.changeMint(MINT2, { scope: "bolt12" });

    tm.assertStep("dismiss");
    expect(tm.machine.getContext().destination).toBeUndefined();

    const notices = tm.notificationCalls.filter(
      (c) => c.key === "onReceiveMethodMintChanged",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].data).toMatchObject({ method: "bolt12", mintUrl: MINT2 });
    expect(
      tm.notificationCalls.some((c) => c.key === "onPreferredMintChanged"),
    ).toBe(false);
    expect(tm.notificationCalls.some((c) => c.key === "onNpcMintChanged")).toBe(
      false,
    );
  });

  it("onchain scope routes the same lane with its own method", async () => {
    const tm = createTestMachine({ wallet: reusableWallet() });

    await tm.machine.requestMintSelector({ scope: "onchain" });
    tm.assertStep("selectMint");
    const data = lastSelectMintData(tm);
    expect(data.scope).toBe("onchain");
    expect(data.methodRequirement).toMatchObject({
      operation: "mint",
      method: "onchain",
    });

    await tm.machine.changeMint(MINT2, { scope: "onchain" });
    tm.assertStep("dismiss");
    const notices = tm.notificationCalls.filter(
      (c) => c.key === "onReceiveMethodMintChanged",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].data).toMatchObject({
      method: "onchain",
      mintUrl: MINT2,
    });
  });
});
