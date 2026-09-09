import { describe, expect, it, vi } from "vitest";
import { createTestMachine } from "../_harness";
import { MINT1 } from "../_harness/fixtures";
import { createAmountActionManager } from "../../src/amount-actions/createManager";

const proofs = Array.from(
  { length: 80 },
  (_, index) => 2 ** ((index % 20) + 1),
);

describe("ecash interaction handoff", () => {
  it.each([true, false])(
    "exposes busy before settlement and ignores duplicate amount submits (offline=%s)",
    async (offline) => {
      let finish!: (value: { historyEntry: string }) => void;
      const executeOfflineSend = vi.fn(
        () =>
          new Promise<{ historyEntry: string }>((resolve) => {
            finish = resolve;
          }),
      );
      const executeSend = vi.fn();
      const tm = createTestMachine({
        offline,
        wallet: {
          proofAmounts: { [MINT1]: proofs },
          mintBalances: { [MINT1]: proofs.reduce((a, b) => a + b, 0) },
        },
        operations: { executeOfflineSend, executeSend },
      });
      await tm.machine.startSendEcash({ entrySource: "createEcash" });
      tm.assertStep("enterAmount");
      const pending = tm.machine.enterAmount(
        { value: 1_999_998, unit: "sat" },
        MINT1,
      );
      expect(tm.machine.inspect().isExecuting).toBe(true);
      await tm.machine.enterAmount({ value: 1_999_998, unit: "sat" }, MINT1);
      expect(executeOfflineSend).toHaveBeenCalledTimes(1);
      expect(executeSend).not.toHaveBeenCalled();
      tm.assertStep("confirmSend");
      finish({
        historyEntry: JSON.stringify({
          id: "send-1",
          type: "send",
          state: "pending",
          mintUrl: MINT1,
          amount: 1_999_998,
          unit: "sat",
        }),
      });
      await pending;
      tm.assertStep("sendComplete");
      expect(tm.machine.inspect().isExecuting).toBe(false);
    },
  );

  it("keeps amount display, fiat conversion, suggestions and snapshot identity with many denominations", () => {
    const manager = createAmountActionManager({
      getMintUrl: () => MINT1,
      getProofAmounts: () => proofs,
      getBtcPrice: () => 100_000,
      offlineOptimization: true,
      unit: "sat",
      fiatCurrency: "usd",
      fiatSymbol: "$",
    });
    const initial = manager.inspect();
    expect(initial.suggestions.length).toBeGreaterThan(0);
    expect(manager.inspect()).toBe(initial);
    manager.setInput("1999999");
    const unavailable = manager.inspect();
    expect(unavailable.effectiveAmount).toEqual({
      value: 1_999_999,
      unit: "sat",
    });
    expect(unavailable.canSendOffline).toBe(false);
    manager.setInput("1999998");
    expect(manager.inspect().canSendOffline).toBe(true);
    manager.setMode("fiat");
    manager.setInput("19.99");
    const fiat = manager.inspect();
    expect(fiat.effectiveAmount.unit).toBe("sat");
    expect(fiat.displayFiat).toBe(19.99);
    expect(manager.inspect()).toBe(fiat);
  });
});
