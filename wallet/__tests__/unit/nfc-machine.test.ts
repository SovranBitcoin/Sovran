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
  contextLags = false,
  satBalances = { [accepted]: 500, [other]: 1000, [third]: 2000 },
  unitSwitchTakes = true,
  operations = {},
}: {
  unit?: string;
  amount?: number | null;
  mints?: string[];
  balances?: Record<string, number>;
  switchEnabled?: boolean;
  mintsPreferred?: boolean;
  hasSpendingCondition?: boolean;
  /** The bound wallet context still shows the old unit's balances after a switch. */
  contextLags?: boolean;
  satBalances?: Record<string, number>;
  /** Whether the host's unit actually changes when asked to. */
  unitSwitchTakes?: boolean;
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
    sat: satBalances,
    [unit]: balances,
  };
  const getContext = (): WalletContext => ({
    trustedMintUrls: [accepted, other, third],
    mintBalances: unitBalances[contextLags ? "sat" : activeUnit] ?? {},
    unitBalances,
    proofAmounts: {},
  });
  const switchUnit = vi.fn(async (next: string) => {
    if (unitSwitchTakes) activeUnit = next;
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
    tm.assertError({ code: "UNSUPPORTED_PAYMENT_METHOD" });
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
    expect(sentMint(tm)?.args).toEqual([{ mintUrl: other, amount: 50, unit: "usd" }]);
  });
  it("chooses by the new unit's balances when the wallet context has not caught up", async () => {
    // `accepted` holds nothing in sat and the whole usd balance. A context
    // still showing sat balances would find no mint able to pay.
    const { tm } = setup({
      unit: "usd",
      mints: [accepted],
      balances: { [accepted]: 100 },
      satBalances: { [other]: 1000 },
      contextLags: true,
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([{ mintUrl: accepted, amount: 50, unit: "usd" }]);
  });
  it("keeps the new unit's balances when it has to choose between several mints", async () => {
    // Two accepted mints funded in usd; in sat only `third` holds anything.
    // The choice between them is made after another read of the context.
    const { tm } = setup({
      unit: "usd",
      mints: [accepted, other],
      balances: { [accepted]: 60, [other]: 100 },
      satBalances: { [third]: 2000 },
      contextLags: true,
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([{ mintUrl: other, amount: 50, unit: "usd" }]);
  });
  it("stops when the host reports a switch that did not change the unit", async () => {
    const { tm, adapter } = setup({ unit: "usd", unitSwitchTakes: false });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    expect(tm.machine.getStep()).not.toBe("sendComplete");
    expect(sentMint(tm)).toBeUndefined();
    expect(adapter.writeToken).not.toHaveBeenCalled();
  });
  it("honours strict m even when a different trusted mint holds more", async () => {
    const { tm } = setup({ balances: { [accepted]: 100, [other]: 1000 } });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([{ mintUrl: accepted, amount: 50, unit: "sat" }]);
  });
  it("ranks accepted candidates by balance, not trusted order", async () => {
    const { tm } = setup({
      mints: [accepted, other],
      balances: { [accepted]: 100, [other]: 200, [third]: 1000 },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(sentMint(tm)?.args).toEqual([{ mintUrl: other, amount: 50, unit: "sat" }]);
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
      // Paid: the flow keeps its unit and nothing of the request.
      tm.assertContext({ unit: "usd" });
      expect(sentMint(tm)?.args).toEqual([{ mintUrl: accepted, amount: 50, unit: "usd" }]);
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
      tm.assertError({
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
    expect(sentMint(tm)?.args).toEqual([{ mintUrl: other, amount: 50, unit: "usd" }]);
  });
  it("retains the existing hard-stop without a host switch operation", async () => {
    const { tm } = setup({ unit: "usd", switchEnabled: false });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "UNSUPPORTED_PAYMENT_METHOD" });
    expect(sentMint(tm)).toBeUndefined();
  });
  it("keeps non-NFC unit mismatch interactive", async () => {
    const { tm, switchUnit } = setup({ unit: "usd" });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertError({ code: "UNSUPPORTED_PAYMENT_METHOD" });
    expect(switchUnit).not.toHaveBeenCalled();
  });
  it("releases the session without sending when the host switch rejects", async () => {
    const { tm, switchUnit, adapter } = setup({ unit: "usd" });
    switchUnit.mockRejectedValueOnce(new Error("host switch failed"));
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "NFC_READ_FAILED" });
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
  it("does nothing more after a reset while it restores the unit", async () => {
    const { tm, switchUnit, adapter } = setup({ unit: "usd" });
    adapter.writeToken.mockRejectedValueOnce(new Error("tag lost"));
    let restored!: () => void;
    switchUnit.mockImplementationOnce(async () => {});
    switchUnit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          restored = resolve;
        }),
    );
    const pending = tm.machine.scan!(INPUTS.paymentRequestBasic, {
      source: "nfc",
    });
    await vi.waitFor(() => expect(switchUnit).toHaveBeenCalledWith("sat"));
    const handled = tm.handlerCalls.length;

    tm.machine.reset();
    restored();
    await pending;

    tm.assertStep("idle");
    expect(tm.handlerCalls).toHaveLength(handled);
    expect(tm.machine.inspect().isExecuting).toBe(false);
  });
  it("rejects amountless requests before switching units", async () => {
    const { tm, switchUnit } = setup({ unit: "usd", amount: null });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "NFC_READ_FAILED" });
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
  vi.fn(async (_request: { mintUrl: string; unit: string }) => ({
    payable: false as const,
    reason,
  }));

describe("NFC mint choice honours the payment-request gate", () => {
  it("skips a mint the send would refuse and pays from the next one", async () => {
    // `other` outranks `accepted` on balance, but its keysets charge fees.
    const payability = vi.fn(async ({ mintUrl }: { mintUrl: string; unit: string }) =>
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
    expect(sentMint(tm)?.args).toEqual([{ mintUrl: accepted, amount: 50, unit: "sat" }]);
    expect(payability.mock.calls.map(([{ mintUrl }]) => mintUrl)).toEqual([other, accepted]);
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
    tm.assertError({ code: "PAYMENT_REQUEST_FAILED", message: reason });
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
    tm.assertError({ code: "NFC_WRITE_FAILED" });
    expect(adapter.writeToken).not.toHaveBeenCalled();
    expect(tm.notificationCalls).toContainEqual({
      key: "onNfcWriteFailed",
      data: {
        message: "mint offline",
        authored: false,
        rolledBack: false,
        stage: "prepare",
      },
    });
  });
});

// Each way out of a tap, for a request in a unit the host had to switch to:
// how often the tag session was released, and the host's unit switches in
// order. A paid tap keeps the terminal's unit; any other end restores it.
describe("what an NFC tap leaves behind when it ends", () => {
  const unitSwitches = (switchUnit: ReturnType<typeof setup>["switchUnit"]) =>
    switchUnit.mock.calls.map(([unit]) => unit);

  it("keeps the terminal's unit after it pays and writes back", async () => {
    const { tm, adapter, switchUnit } = setup({ unit: "usd" });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd"]);
  });

  it("restores the unit after the write-back fails", async () => {
    const { tm, adapter, switchUnit } = setup({ unit: "usd" });
    adapter.writeToken.mockRejectedValueOnce(new Error("tag lost"));
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "NFC_WRITE_FAILED" });
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd", "sat"]);
  });

  it("restores the unit after the token cannot be created", async () => {
    const { tm, adapter, switchUnit } = setup({
      unit: "usd",
      operations: {
        executeNfcSend: vi.fn(async () => {
          throw new Error("mint offline");
        }),
      },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "NFC_WRITE_FAILED" });
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd", "sat"]);
  });

  it("restores the unit after every funded mint was refused", async () => {
    const { tm, adapter, switchUnit } = setup({
      unit: "usd",
      operations: { paymentRequestPayabilityFrom: refuseFees("fees") },
    });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "PAYMENT_REQUEST_FAILED", message: "fees" });
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd", "sat"]);
  });

  it("restores the unit when the request stops on an error after the switch", async () => {
    const { tm, adapter, switchUnit } = setup({ unit: "usd", unitSwitchTakes: false });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("error");
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd", "sat"]);
  });

  it("releases once and switches nothing when the unit is not funded", async () => {
    const { tm, adapter, switchUnit } = setup({ unit: "usd", balances: {} });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "UNIT_NOT_FUNDED" });
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual([]);
  });

  it("releases once and restores nothing when the switch itself fails", async () => {
    const { tm, adapter, switchUnit } = setup({ unit: "usd" });
    switchUnit.mockRejectedValueOnce(new Error("host switch failed"));
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({ code: "NFC_READ_FAILED" });
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd"]);
  });

  // A BIP21 tag with a USD ecash request no mint can pay, beside a sat
  // invoice: in USD the invoice asks for an amount, which a tap cannot give.
  it("restores the unit when the tag's invoice asks for an amount", async () => {
    let activeUnit = "sat";
    const unitBalances = { sat: { [MINT2]: 1500 }, usd: { [MINT2]: 5000 } };
    const switchUnit = vi.fn(async (next: string) => {
      activeUnit = next;
    });
    const adapter = {
      readPaymentRequest: vi.fn(async () => ""),
      writeToken: vi.fn(async () => {}),
      releaseSession: vi.fn(async () => {}),
      isAvailable: vi.fn(async () => true),
    };
    const tm = createTestMachine({
      getUnit: () => activeUnit,
      getContext: () => ({
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: unitBalances[activeUnit as "sat" | "usd"],
        unitBalances,
        proofAmounts: {},
        mintMethodCapabilities: WALLETS.default.mintMethodCapabilities,
        preferredMintUrl: MINT2,
      }),
      detectors: {
        getPaymentRequestInfo: () => ({
          unit: "usd",
          amount: 60,
          mints: [MINT2],
          mintsPreferred: true,
          hasSpendingCondition: false,
        }),
      },
      nfcAdapter: adapter,
      operations: { switchUnit, paymentRequestPayabilityFrom: refuseFees("fees") },
    });
    await tm.machine.scan!(
      `bitcoin:?creq=${INPUTS.paymentRequestBasic}&lightning=${NFC_TAG_INVOICE}`,
      { source: "nfc" },
    );
    tm.assertError({ code: "NFC_READ_FAILED" });
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd", "sat"]);
  });

  it("releases once when a tag without an amount asks for one", async () => {
    const { tm, adapter, switchUnit } = setup();
    await tm.machine.scan!(INPUTS.lightningAddress, { source: "nfc" });
    tm.assertError({ code: "NFC_READ_FAILED" });
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual([]);
  });

  // The throw still ends in the turn's safety net; the tap ends first.
  it("releases the tag and restores the unit when a check throws mid-tap", async () => {
    const { tm, adapter, switchUnit } = setup({
      unit: "usd",
      operations: {
        paymentRequestPayabilityFrom: vi.fn(async () => {
          throw new Error("keysets unreadable");
        }),
      },
    });
    await expect(
      tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" }),
    ).resolves.toBeDefined();
    expect(sentMint(tm)).toBeUndefined();
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(unitSwitches(switchUnit)).toEqual(["usd", "sat"]);
    expect(tm.machine.inspect().isExecuting).toBe(false);
  });

  // A reset owns the machine now: the stranded tap changes no step, runs no
  // handler and sends nothing, but still lets go of the tag and the unit.
  describe("after a reset overtakes it", () => {
    type Deferred = { promise: Promise<void>; resolve: () => void };
    const deferred = (): Deferred => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    async function overtake(
      tap: ReturnType<typeof setup>,
      waiting: Deferred,
      reached: () => void,
    ) {
      const pending = tap.tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
      await vi.waitFor(reached);
      const handled = tap.tm.handlerCalls.length;
      tap.tm.machine.reset();
      waiting.resolve();
      await pending;
      tap.tm.assertStep("idle");
      expect(tap.tm.handlerCalls).toHaveLength(handled);
      expect(tap.tm.machine.inspect().isExecuting).toBe(false);
    }

    it("releases the tag and switches the unit back during the switch", async () => {
      const tap = setup({ unit: "usd" });
      const switched = deferred();
      tap.switchUnit.mockImplementationOnce(() => switched.promise);
      await overtake(tap, switched, () => expect(tap.switchUnit).toHaveBeenCalledTimes(1));
      expect(sentMint(tap.tm)).toBeUndefined();
      expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1);
      expect(unitSwitches(tap.switchUnit)).toEqual(["usd", "sat"]);
    });

    it.each([
      { picked: "the resolver", mints: [accepted] },
      { picked: "the mint list", mints: [accepted, other] },
    ])("releases the tag and switches the unit back during the payability check of a mint $picked chose", async ({ mints }) => {
      const checked = deferred();
      const payability = vi.fn(async () => {
        await checked.promise;
        return { payable: true as const };
      });
      const tap = setup({
        unit: "usd",
        mints,
        balances: { [accepted]: 100, [other]: 100 },
        operations: { paymentRequestPayabilityFrom: payability },
      });
      await overtake(tap, checked, () => expect(payability).toHaveBeenCalledTimes(1));
      expect(sentMint(tap.tm)).toBeUndefined();
      expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1);
      expect(unitSwitches(tap.switchUnit)).toEqual(["usd", "sat"]);
    });

    it("switches the unit back during the release", async () => {
      const tap = setup({ unit: "usd", operations: { paymentRequestPayabilityFrom: refuseFees("fees") } });
      const released = deferred();
      tap.adapter.releaseSession.mockImplementationOnce(() => released.promise);
      await overtake(tap, released, () => expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1));
      expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1);
      expect(unitSwitches(tap.switchUnit)).toEqual(["usd", "sat"]);
    });

    it("takes the token back, releases the tag and switches the unit back while the token is created", async () => {
      const created = deferred();
      const executeNfcSend = vi.fn(async () => {
        await created.promise;
        return { token: "cashuB-token", operationId: "op-1", historyEntry: "{}" };
      });
      const tap = setup({ unit: "usd", operations: { executeNfcSend } });
      await overtake(tap, created, () => expect(executeNfcSend).toHaveBeenCalledTimes(1));
      expect(tap.adapter.writeToken).not.toHaveBeenCalled();
      expect(
        tap.tm.operationCalls.filter((call) => call.name === "rollbackSend").map((call) => call.args),
      ).toEqual([["op-1"]]);
      expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1);
      expect(unitSwitches(tap.switchUnit)).toEqual(["usd", "sat"]);
    });

    it("releases the tag and keeps the terminal's unit once the token is on the tag", async () => {
      const tap = setup({ unit: "usd" });
      const written = deferred();
      tap.adapter.writeToken.mockImplementationOnce(() => written.promise);
      await overtake(tap, written, () => expect(tap.adapter.writeToken).toHaveBeenCalledTimes(1));
      expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1);
      expect(unitSwitches(tap.switchUnit)).toEqual(["usd"]);
    });

    // Once the write began the terminal may hold the token, even when the
    // write then reports failure (its last acknowledgement can be lost).
    it("does not take the token back when the write it overtook then fails", async () => {
      const tap = setup({ unit: "usd" });
      let failWrite!: (error: Error) => void;
      tap.adapter.writeToken.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failWrite = reject;
          }),
      );
      const written: Deferred = {
        promise: Promise.resolve(),
        resolve: () => failWrite(new Error("tag lost")),
      };
      await overtake(tap, written, () => expect(tap.adapter.writeToken).toHaveBeenCalledTimes(1));
      expect(tap.tm.operationCalls.filter((call) => call.name === "rollbackSend")).toEqual([]);
      expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1);
      // The reset left nothing that could rebuild the payment.
      expect(Object.keys(tap.tm.machine.getContext())).toEqual(["unit"]);
    });

    // The session and the unit hold one tap at a time. A newer tap's read
    // took the session over; a newer tap the machine runs owns the unit.
    describe("when a newer tap began after the reset", () => {
      it("leaves the tag and the unit to a newer tap the machine runs", async () => {
        const createdA = deferred();
        const createdB = deferred();
        const executeNfcSend = vi
          .fn()
          .mockImplementationOnce(async () => {
            await createdA.promise;
            return { token: "cashuB-a", operationId: "op-a", historyEntry: "{}" };
          })
          .mockImplementationOnce(async () => {
            await createdB.promise;
            return { token: "cashuB-b", operationId: "op-b", historyEntry: "{}" };
          });
        const { tm, adapter, switchUnit } = setup({ unit: "usd", operations: { executeNfcSend } });
        const tapA = tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
        await vi.waitFor(() => expect(executeNfcSend).toHaveBeenCalledTimes(1));
        tm.machine.reset();
        const tapB = tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
        await vi.waitFor(() => expect(executeNfcSend).toHaveBeenCalledTimes(2));

        createdA.resolve();
        await tapA;
        expect(adapter.releaseSession).not.toHaveBeenCalled();
        expect(unitSwitches(switchUnit)).toEqual(["usd"]);

        createdB.resolve();
        await tapB;
        tm.assertStep("sendComplete");
        expect(adapter.writeToken.mock.calls).toEqual([["cashuB-b"]]);
        expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
        expect(unitSwitches(switchUnit)).toEqual(["usd"]);
      });

      it("switches the unit back but leaves the tag to a newer tap still reading", async () => {
        const created = deferred();
        const executeNfcSend = vi.fn(async () => {
          await created.promise;
          return { token: "cashuB-a", operationId: "op-a", historyEntry: "{}" };
        });
        const { tm, adapter, switchUnit } = setup({ unit: "usd", operations: { executeNfcSend } });
        adapter.readPaymentRequest.mockImplementationOnce(
          () => new Promise<typeof INPUTS.paymentRequestBasic>(() => {}),
        );
        const tapA = tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
        await vi.waitFor(() => expect(executeNfcSend).toHaveBeenCalledTimes(1));
        tm.machine.reset();
        void tm.machine.scan!(undefined, { source: "nfc" });
        await vi.waitFor(() => expect(adapter.readPaymentRequest).toHaveBeenCalledTimes(1));

        created.resolve();
        await tapA;
        expect(adapter.releaseSession).not.toHaveBeenCalled();
        expect(unitSwitches(switchUnit)).toEqual(["usd", "sat"]);
      });
    });
  });
});

// The tag holds the token: the request is paid, and nothing done on the
// screen that follows rebuilds it for Pay to send a second time.
describe("a paid NFC tap", () => {
  const sent = (tm: ReturnType<typeof createTestMachine>) =>
    tm.operationCalls.filter(
      (call) => call.name === "executeNfcSend" || call.name === "executePaymentRequest",
    ).length;

  it("is not sent again from the mint list", async () => {
    const { tm } = setup();
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertStep("sendComplete");

    await tm.machine.requestMintSelector();
    await tm.machine.confirmPaymentRequest();

    expect(sent(tm)).toBe(1);
  });

  it("is not sent again after choosing a mint or an amount", async () => {
    for (const choose of [
      (tm: ReturnType<typeof createTestMachine>) => tm.machine.changeMint(accepted),
      (tm: ReturnType<typeof createTestMachine>) =>
        tm.machine.enterAmount({ value: 50, unit: "sat" }, accepted),
    ]) {
      const { tm } = setup();
      await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
      tm.assertStep("sendComplete");

      await choose(tm);
      await tm.machine.confirmPaymentRequest();

      expect(sent(tm)).toBe(1);
    }
  });
});

// The write failed and taking the token back failed too: the token may have
// reached the terminal, so the tap is treated as sent and nothing done on the
// error screen rebuilds the request for Pay to send again.
describe("an NFC tap whose token could not be taken back", () => {
  const sent = (tm: ReturnType<typeof createTestMachine>) =>
    tm.operationCalls.filter(
      (call) => call.name === "executeNfcSend" || call.name === "executePaymentRequest",
    ).length;

  function failedTap() {
    const tap = setup({
      operations: {
        rollbackSend: vi.fn(async () => {
          throw new Error("mint unreachable");
        }),
      },
    });
    tap.adapter.writeToken.mockRejectedValueOnce(new Error("tag lost"));
    return tap;
  }

  // Taking it back that returns without saying it did (the send could not
  // be looked up, was not found, or is in a state it does not reclaim) is
  // not a token taken back.
  it("treats a take-back that could not tell as not taken back", async () => {
    const tap = setup({
      operations: {
        rollbackSend: vi.fn(async () => ({ kind: "unknown" as const, reason: "notFound" as const })),
      },
    });
    tap.adapter.writeToken.mockRejectedValueOnce(new Error("tag lost"));
    await tap.tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tap.tm.assertError({
      code: "NFC_WRITE_FAILED",
      message: expect.stringMatching(/may have reached the terminal/),
    });
    // Nothing is kept that could rebuild the request for Pay to send again.
    expect(tap.tm.machine.getContext()).not.toHaveProperty("paymentRequest");
    expect(tap.tm.machine.getContext()).not.toHaveProperty("amount");
  });

  it("says the first token may have gone out", async () => {
    const { tm } = failedTap();
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    tm.assertError({
      code: "NFC_WRITE_FAILED",
      message: expect.stringMatching(/may have reached the terminal/),
    });
    expect(tm.notificationCalls).toContainEqual({
      key: "onNfcWriteFailed",
      data: expect.objectContaining({
        message: expect.stringMatching(/may have reached the terminal/),
        authored: true,
        rolledBack: false,
        stage: "write",
      }),
    });
  });

  it("is not sent again after choosing a mint, an amount or the mint list", async () => {
    for (const choose of [
      (tm: ReturnType<typeof createTestMachine>) => tm.machine.changeMint(accepted),
      (tm: ReturnType<typeof createTestMachine>) =>
        tm.machine.enterAmount({ value: 50, unit: "sat" }, accepted),
      (tm: ReturnType<typeof createTestMachine>) => tm.machine.requestMintSelector(),
    ]) {
      const { tm } = failedTap();
      await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
      tm.assertStep("error");

      await choose(tm);
      await tm.machine.confirmPaymentRequest();

      expect(sent(tm)).toBe(1);
    }
  });
});

// A read belongs to the moment it began: which NFC read it is decides whether
// its tap may still let go of the tag, and only a read makes a tap at all.
describe("an NFC read that finishes late", () => {
  type Request = typeof INPUTS.paymentRequestBasic;
  type Held = { promise: Promise<Request>; resolve: (data: Request) => void };
  const held = (): Held => {
    let resolve!: (data: Request) => void;
    const promise = new Promise<Request>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it("leaves the tag to a read that began after it", async () => {
    const { tm, adapter } = setup();
    const readA = held();
    adapter.readPaymentRequest
      .mockImplementationOnce(() => readA.promise)
      .mockImplementationOnce(() => new Promise<Request>(() => {}));
    const tapA = tm.machine.scan!(undefined, { source: "nfc" });
    await vi.waitFor(() => expect(adapter.readPaymentRequest).toHaveBeenCalledTimes(1));
    void tm.machine.scan!(undefined, { source: "nfc" });
    await vi.waitFor(() => expect(adapter.readPaymentRequest).toHaveBeenCalledTimes(2));

    readA.resolve(INPUTS.paymentRequestBasic);
    await tapA;

    expect(adapter.releaseSession).not.toHaveBeenCalled();
  });

  it("does not turn a later input into a tap when the machine did not take the read", async () => {
    let finishSend!: () => void;
    const { tm } = setup({
      operations: {
        executeSend: vi.fn(async () => {
          await new Promise<void>((resolve) => {
            finishSend = resolve;
          });
          return { historyEntry: JSON.stringify({ id: "tx-send", type: "send" }) };
        }),
        executeOfflineSend: undefined,
      },
    });
    await tm.machine.startSendEcash({ reset: true });
    const sending = tm.machine.enterAmount({ value: 10, unit: "sat" }, accepted, {
      destination: "sendEcash",
    });
    await vi.waitFor(() => expect(finishSend).toBeTypeOf("function"));
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    finishSend();
    await sending;

    await tm.machine.execute(INPUTS.paymentRequestBasic);

    expect(sentMint(tm)).toBeUndefined();
    tm.assertStep("navigateToPaymentRequest");
  });
});

// A read that succeeds while a payment is being made is not taken: nothing
// pays from it, its session is let go (unless a newer read took it over),
// and the host hears that the scan did not go through.
describe("an NFC read the machine is too busy to take", () => {
  function busyTap() {
    let finishSend: (() => void) | undefined;
    const tap = setup({
      operations: {
        executeSend: vi.fn(async () => {
          await new Promise<void>((resolve) => {
            finishSend = resolve;
          });
          return { historyEntry: JSON.stringify({ id: "tx-send", type: "send" }) };
        }),
        executeOfflineSend: undefined,
      },
    });
    const start = async () => {
      await tap.tm.machine.startSendEcash({ reset: true });
      const sending = tap.tm.machine.enterAmount({ value: 10, unit: "sat" }, accepted, {
        destination: "sendEcash",
      });
      await vi.waitFor(() => expect(finishSend).toBeTypeOf("function"));
      return async () => {
        finishSend!();
        await sending;
      };
    };
    return { ...tap, start };
  }

  it("lets the session go and says the scan did not go through", async () => {
    const tap = busyTap();
    const done = await tap.start();

    await tap.tm.machine.scan!(undefined, { source: "nfc" });

    expect(sentMint(tap.tm)).toBeUndefined();
    expect(tap.adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(tap.tm.notificationCalls.filter((call) => call.key === "onScanError")).toEqual([
      { key: "onScanError", data: ["nfc", expect.any(Error)] },
    ]);
    await done();
    tap.tm.assertStep("sendComplete");
  });

  it("leaves the session to a read that began after it", async () => {
    const tap = busyTap();
    const done = await tap.start();
    let finishRead!: (data: typeof INPUTS.paymentRequestBasic) => void;
    tap.adapter.readPaymentRequest
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const readA = tap.tm.machine.scan!(undefined, { source: "nfc" });
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
    void tap.tm.machine.scan!(undefined, { source: "nfc" });
    await vi.waitFor(() => expect(tap.adapter.readPaymentRequest).toHaveBeenCalledTimes(2));

    finishRead(INPUTS.paymentRequestBasic);
    await readA;

    expect(tap.adapter.releaseSession).not.toHaveBeenCalled();
    await done();
  });
});
