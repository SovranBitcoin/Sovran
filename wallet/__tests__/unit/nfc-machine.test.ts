import { describe, expect, it, vi } from "vitest";
import { createTestMachine } from "../_harness/createTestMachine";
import { INPUTS, MINT1, MINT2, WALLETS } from "../_harness/fixtures";
import type { MachineOperations } from "../../src/machine/types";
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
  mintsPreferred = false,
  hasSpendingCondition = false,
  operations = {},
}: {
  unit?: string;
  amount?: number | null;
  mints?: string[];
  balances?: Record<string, number>;
  switchEnabled?: boolean;
  mintsPreferred?: boolean;
  hasSpendingCondition?: boolean;
  operations?: Partial<MachineOperations>;
} = {}) {
  let activeUnit = "sat";
  const info: PaymentRequestInfo = {
    unit,
    amount: amount ?? undefined,
    mints,
    mintsPreferred,
    hasSpendingCondition,
  };
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
    operations: {
      switchUnit: switchEnabled ? switchUnit : undefined,
      ...operations,
    },
  });
  return { tm, adapter, switchUnit };
}

const sentMint = (tm: ReturnType<typeof createTestMachine>) =>
  tm.operationCalls.find((call) => call.name === "executeNfcSend");

describe("NFC terminal unit and mints", () => {
  it("rejects spending conditions before switching units or creating bearer ecash", async () => {
    const { tm, switchUnit, adapter } = setup({
      unit: "usd",
      hasSpendingCondition: true,
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertExecution({ code: "UNSUPPORTED_PAYMENT_METHOD" });
    expect(switchUnit).not.toHaveBeenCalled();
    expect(sentMint(tm)).toBeUndefined();
    expect(adapter.writeToken).not.toHaveBeenCalled();
    expect(adapter.releaseSession).toHaveBeenCalled();
  });
  it("switches to a funded non-preferred mint for an advisory cross-unit request", async () => {
    const { tm, switchUnit } = setup({
      unit: "usd",
      balances: { [other]: 100 },
      mintsPreferred: true,
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    expect(switchUnit).toHaveBeenCalledWith("usd");
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([other, 50, "usd"]);
  });
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

/** 1000-sat bolt11 (10u); the same invoice lightning-melt.test.ts pays. */
const NFC_TAG_INVOICE =
  "lnbc10u1p4pcn75pp5nx5zweympssrmvmecek6n3ynhj7emfe3dynls8q3yu62uhje9rksdqqcqzzsxqyz5vqsp5lersjjw2atsnqhzhqac00xvvcelcw6gqfy7u2jka25q9y2dhczns9qxpqysgqckuv826yw544mrwgnt6k0r529wrczsj03hwrtgg0ch4gewreqt75gg838wrd6twg5dp7n9m9eze6km22svvx8jq5jmrv4pvr0q4dffqpp0ftc3";

describe("NFC-scanned invoice stays interactive after the tap", () => {
  function setupInvoiceTap() {
    const adapter = {
      readPaymentRequest: vi.fn(async () => NFC_TAG_INVOICE),
      writeToken: vi.fn(async () => {}),
      releaseSession: vi.fn(async () => {}),
      isAvailable: vi.fn(async () => true),
    };
    const tm = createTestMachine({
      wallet: {
        ...WALLETS.default,
        mintBalances: { [MINT1]: 1500, [MINT2]: 2000 },
      },
      nfcAdapter: adapter,
    });
    return { tm, adapter };
  }

  it("opens the mint list from the pill instead of auto-picking again", async () => {
    const { tm, adapter } = setupInvoiceTap();
    await tm.machine.scan!(NFC_TAG_INVOICE, { source: "nfc" });
    tm.assertStep("navigateToMeltPreview");
    tm.assertContext({ mintUrl: MINT1, amount: 1000, source: "nfc" });
    // The tag session ends at the preview: everything after is the user's.
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);

    await tm.machine.requestMintSelector();
    tm.assertStep("selectMint");
    expect(tm.handlerCalls.at(-1)?.step).toBe("selectMint");
    const candidates = (tm.handlerCalls.at(-1)?.data as { candidates: { mintUrl: string }[] })
      .candidates;
    expect(candidates.map((c) => c.mintUrl).sort()).toEqual([MINT1, MINT2].sort());

    await tm.machine.changeMint(MINT2);
    tm.assertStep("navigateToMeltPreview");
    tm.assertContext({ mintUrl: MINT2, amount: 1000 });
  });
});

const refuseFees = (reason = "This payment request needs a mint without ecash redemption fees.") =>
  vi.fn(async (_mintUrl: string, _unit: string) => ({ payable: false as const, reason }));

describe("NFC mint choice honours the payment-request gate", () => {
  it("skips a mint the send would refuse and pays from the next one", async () => {
    // `other` outranks `accepted` on balance, but its keysets charge fees.
    const payability = vi.fn(async (mintUrl: string) =>
      mintUrl === other
        ? { payable: false as const, reason: "fees" }
        : { payable: true as const },
    );
    const { tm, adapter } = setup({
      mints: [accepted, other],
      balances: { [accepted]: 100, [other]: 200 },
      operations: { paymentRequestPayabilityFrom: payability },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([accepted, 50, "sat"]);
    expect(payability.mock.calls.map(([mintUrl]) => mintUrl)).toEqual([other, accepted]);
    expect(adapter.writeToken).toHaveBeenCalledTimes(1);
  });

  it("falls back to the tag's Lightning invoice when no mint can pay the request", async () => {
    const adapter = {
      readPaymentRequest: vi.fn(async () => ""),
      writeToken: vi.fn(async () => {}),
      releaseSession: vi.fn(async () => {}),
      isAvailable: vi.fn(async () => true),
    };
    const tm = createTestMachine({
      wallet: { ...WALLETS.default, mintBalances: { [MINT1]: 5000, [MINT2]: 5000 } },
      nfcAdapter: adapter,
      operations: { paymentRequestPayabilityFrom: refuseFees() },
    });
    await tm.machine.scan!(
      `bitcoin:?creq=${INPUTS.paymentRequestBasic}&lightning=${NFC_TAG_INVOICE}`,
      { source: "nfc" },
    );
    tm.assertStep("navigateToMeltPreview");
    tm.assertContext({ meltTarget: NFC_TAG_INVOICE, amount: 1000, source: "nfc" });
    expect(sentMint(tm)).toBeUndefined();
    expect(adapter.writeToken).not.toHaveBeenCalled();
    // The invoice is paid over the network; the tag session is done.
    expect(adapter.releaseSession).toHaveBeenCalled();
  });

  it("explains an unpayable request when the tag offers nothing else", async () => {
    const reason = "This payment request needs a mint without ecash redemption fees.";
    const { tm, adapter } = setup({
      mints: [accepted, other],
      balances: { [accepted]: 100, [other]: 200 },
      operations: { paymentRequestPayabilityFrom: refuseFees(reason) },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertExecution({ code: "PAYMENT_REQUEST_FAILED", message: reason });
    expect(sentMint(tm)).toBeUndefined();
    expect(adapter.writeToken).not.toHaveBeenCalled();
    expect(adapter.releaseSession).toHaveBeenCalled();
  });

  it("labels a failure before token creation as a prepare-stage failure", async () => {
    const { tm, adapter } = setup({
      operations: {
        executeNfcSend: vi.fn(async () => {
          throw new Error("mint offline");
        }),
      },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertExecution({ code: "NFC_WRITE_FAILED" });
    expect(adapter.writeToken).not.toHaveBeenCalled();
    expect(tm.notificationCalls).toContainEqual({
      key: "onNfcWriteFailed",
      data: { message: "mint offline", rolledBack: false, stage: "prepare" },
    });
  });
});
