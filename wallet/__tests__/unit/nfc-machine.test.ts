import { describe, expect, it, vi } from "vitest";
import { createTestMachine } from "../_harness/createTestMachine";
import { INPUTS } from "../_harness/fixtures";
import type { WalletContext, PaymentRequestInfo } from "../../src/types";

const accepted = "https://mint1.example.com";
const other = "https://mint2.example.com";
const third = "https://mint3.example.com";

function setup({
  unit = "sat",
  amount = 50,
  mints = [accepted],
  balances = { [accepted]: 100 },
  switchEnabled = true,
}: {
  unit?: string;
  amount?: number | null;
  mints?: string[];
  balances?: Record<string, number>;
  switchEnabled?: boolean;
} = {}) {
  let activeUnit = "sat";
  const info: PaymentRequestInfo = { unit, amount: amount ?? undefined, mints };
  const unitBalances: Record<string, Record<string, number>> = {
    sat: { [accepted]: 500, [other]: 1000, [third]: 2000 },
    [unit]: balances,
  };
  const getContext = (): WalletContext => ({
    trustedMintUrls: [accepted, other, third],
    mintBalances: unitBalances[activeUnit] ?? {},
    unitBalances,
    proofAmounts: {},
  });
  const switchUnit = vi.fn(async (next: string) => {
    activeUnit = next;
  });
  const adapter = {
    readPaymentRequest: vi.fn(async () => INPUTS.paymentRequestBasic),
    writeToken: vi.fn(async () => {}),
    releaseSession: vi.fn(async () => {}),
    isAvailable: vi.fn(async () => true),
  };
  const tm = createTestMachine({
    getUnit: () => activeUnit,
    getContext,
    detectors: { getPaymentRequestInfo: () => info },
    nfcAdapter: adapter,
    operations: { switchUnit: switchEnabled ? switchUnit : undefined },
  });
  return { tm, adapter, switchUnit };
}

const sentMint = (tm: ReturnType<typeof createTestMachine>) =>
  tm.operationCalls.find((call) => call.name === "executeNfcSend");

describe("NFC terminal unit and mints", () => {
  it("honours strict m even when a different trusted mint holds more", async () => {
    const { tm } = setup({ balances: { [accepted]: 100, [other]: 1000 } });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([accepted, 50, "sat"]);
  });
  it("ranks accepted candidates by balance, not trusted order", async () => {
    const { tm } = setup({
      mints: [accepted, other],
      balances: { [accepted]: 100, [other]: 200, [third]: 1000 },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([other, 50, "sat"]);
  });
  it.each([
    INPUTS.paymentRequestBasic,
    `bitcoin:?creq=${INPUTS.paymentRequestBasic}`,
  ])(
    "switches to funded terminal units before resolving request %#",
    async (input) => {
      const { tm, switchUnit } = setup({ unit: "usd" });
      await tm.machine.scan!(input, { source: "nfc" });
      expect(switchUnit).toHaveBeenCalledWith("usd");
      tm.assertStep("sendComplete");
      tm.assertContext({ unit: "usd", amount: 50, mintUrl: accepted });
      expect(sentMint(tm)?.args).toEqual([accepted, 50, "usd"]);
      expect(tm.notificationCalls).toContainEqual({
        key: "onNfcPaymentProgress",
        data: { phase: "selecting" },
      });
    },
  );
  it.each<Record<string, number>>([
    { [accepted]: 49, [other]: 1000 },
    { "https://untrusted.example.com": 1000 },
    {},
  ])(
    "rejects unfunded accepted units without switching or sending",
    async (balances) => {
      const { tm, switchUnit, adapter } = setup({ unit: "usd", balances });
      await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
      tm.assertExecution({
        code: "UNIT_NOT_FUNDED",
        message:
          "This terminal wants USD. You have no USD ecash at an accepted mint.",
      });
      expect(switchUnit).not.toHaveBeenCalled();
      expect(sentMint(tm)).toBeUndefined();
      expect(adapter.writeToken).not.toHaveBeenCalled();
      expect(adapter.releaseSession).toHaveBeenCalled();
    },
  );
  it("allows any trusted funded mint when m is empty", async () => {
    const { tm } = setup({
      unit: "usd",
      mints: [],
      balances: { [other]: 100 },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([other, 50, "usd"]);
  });
  it("retains the existing hard-stop without a host switch operation", async () => {
    const { tm } = setup({ unit: "usd", switchEnabled: false });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertExecution({ code: "UNSUPPORTED_PAYMENT_METHOD" });
    expect(sentMint(tm)).toBeUndefined();
  });
  it("keeps non-NFC unit mismatch interactive", async () => {
    const { tm, switchUnit } = setup({ unit: "usd" });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertExecution({ code: "UNSUPPORTED_PAYMENT_METHOD" });
    expect(switchUnit).not.toHaveBeenCalled();
  });
  it("releases the session without sending when the host switch rejects", async () => {
    const { tm, switchUnit, adapter } = setup({ unit: "usd" });
    switchUnit.mockRejectedValueOnce(new Error("host switch failed"));
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertExecution({ code: "NFC_READ_FAILED" });
    expect(sentMint(tm)).toBeUndefined();
    expect(adapter.releaseSession).toHaveBeenCalled();
  });
  it("does not send after reset interrupts an asynchronous unit switch", async () => {
    const { tm, switchUnit } = setup({ unit: "usd" });
    let finish!: () => void;
    switchUnit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = tm.machine.scan!(INPUTS.paymentRequestBasic, {
      source: "nfc",
    });
    await Promise.resolve();
    tm.machine.reset();
    finish();
    await pending;
    tm.assertStep("idle");
    expect(sentMint(tm)).toBeUndefined();
  });
  it("rejects amountless requests before switching units", async () => {
    const { tm, switchUnit } = setup({ unit: "usd", amount: null });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertExecution({ code: "NFC_READ_FAILED" });
    expect(sentMint(tm)).toBeUndefined();
    expect(switchUnit).not.toHaveBeenCalled();
  });
});
