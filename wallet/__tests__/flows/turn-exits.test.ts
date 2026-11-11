/**
 * turn-exits.test.ts — every way out of one `send()` turn
 *
 * One call to `send()` holds the machine while it runs: later events are
 * dropped, or, when they carry fresh intent during a resolve, take over. These
 * tests pin what each exit of a turn leaves behind:
 *
 *   - whether the machine is free for the next event (probed with an event
 *     that never takes over a turn, so a held lock shows as "ignored"),
 *   - what a waiting `confirmPaymentRequest()` resolves with,
 *   - whether `inspect()` still says a handler is executing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPaymentMachine } from "../../src/machine/createMachine";
import { defaultDetectors } from "../../src/detectors";
import { PaymentRequestUndeliveredError } from "../../src/errors";
import { setLogger } from "../../src/logger";
import type {
  FlowStep,
  MachineOperations,
  MeltQuotePreview,
  NfcIOAdapter,
  StepHandlerMap,
} from "../../src/machine/types";
import type { WalletContext } from "../../src/types";
import { createMockOperations, resetTxCounter } from "../_harness/mockOperations";
import { INPUTS, MINT1, MINT2, WALLETS } from "../_harness/fixtures";
import type { OperationCall } from "../_harness/types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type LogLine = { event: string; fields?: Record<string, unknown> };
let logs: LogLine[] = [];

beforeEach(() => {
  logs = [];
  const record = (event: string, fields?: Record<string, unknown>) => {
    logs.push({ event, fields });
  };
  setLogger({ debug: record, info: record, warn: record, error: record });
});

afterEach(() => {
  setLogger(null);
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued continuation run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type HandlerOverrides = Partial<Record<FlowStep, (data: unknown) => unknown>>;

function build(
  config: {
    handlers?: HandlerOverrides;
    operations?: Partial<MachineOperations>;
    /** Applied as given, past the recording wrapper (which makes every call async). */
    direct?: Partial<MachineOperations>;
    nfcAdapter?: NfcIOAdapter;
    notifications?: Record<string, (data: unknown) => unknown>;
    wallet?: Partial<WalletContext>;
    getContext?: (wallet: WalletContext) => WalletContext;
    getUnit?: () => string;
  } = {},
) {
  resetTxCounter();
  const handlerCalls: { step: string; data: unknown }[] = [];
  const operationCalls: OperationCall[] = [];
  const notificationCalls: { key: string; data: unknown }[] = [];
  // Every step has a handler that records its call, then runs the override.
  const handlers = new Proxy({} as StepHandlerMap, {
    get: (_target, step: string) => (data: unknown) => {
      handlerCalls.push({ step, data });
      return config.handlers?.[step as FlowStep]?.(data);
    },
  });
  const notifications = new Proxy(
    {},
    {
      get: (_target, key: string) => (data: unknown) => {
        notificationCalls.push({ key, data });
        return config.notifications?.[key]?.(data);
      },
    },
  );
  const wallet = { ...WALLETS.default, ...config.wallet };
  const machine = createPaymentMachine({
    handlers,
    detectors: defaultDetectors,
    getContext: () => config.getContext?.(wallet) ?? wallet,
    getUnit: config.getUnit ?? (() => "sat"),
    operations: {
      ...createMockOperations(config.operations, operationCalls),
      ...config.direct,
    },
    notifications,
    nfcAdapter: config.nfcAdapter,
    scanSources: {},
  });
  const calls = (name: string) =>
    operationCalls.filter((call) => call.name === name).length;
  const handled = (step: string) =>
    handlerCalls.filter((call) => call.step === step).length;
  return { machine, handlerCalls, operationCalls, notificationCalls, calls, handled };
}

type Machine = ReturnType<typeof build>["machine"];

/**
 * Whether the next event runs. SEND_MEMO_SUBMITTED never takes over a turn
 * and no step below handles it, so it is either dropped by the lock or
 * reaches `transition` and changes nothing.
 */
async function isFree(machine: Machine): Promise<boolean> {
  const from = logs.length;
  await machine.submitSendMemo();
  const lines = logs
    .slice(from)
    .filter((line) => line.fields?.type === "SEND_MEMO_SUBMITTED");
  const ignored = lines.some((line) => line.event === "machine.event.ignored");
  const ran = lines.some((line) => line.event === "machine.event.unhandled");
  expect(ignored !== ran).toBe(true);
  return ran;
}

const isExecuting = (machine: Machine) => machine.inspect().isExecuting;

/** A subscriber whose render throws once it sees the machine executing. */
function throwWhileExecuting(machine: Machine): () => void {
  return machine.subscribe(() => {
    if (machine.inspect().isExecuting) throw new Error("render failed");
  });
}

function meltQuote(overrides?: Partial<MeltQuotePreview>): MeltQuotePreview {
  return {
    quoteId: "quote-1",
    quoteAmount: 200,
    feeReserve: 2,
    unit: "sat",
    method: "bolt11",
    mintUrl: MINT1,
    meltTarget: INPUTS.lightningAddress,
    flowAmount: 200,
    ...overrides,
  };
}

function mintQuoteEntry(id: string, amount: number) {
  return {
    historyEntry: JSON.stringify({
      id,
      type: "mint",
      createdAt: 1,
      mintUrl: MINT1,
      unit: "sat",
      quoteId: id,
      state: "UNPAID",
      amount,
      paymentRequest: `lnbc-${id}`,
      metadata: { operationId: id },
    }),
  };
}

async function toMeltPreview(machine: Machine) {
  await machine.execute(INPUTS.lightningAddress, { reset: true });
  await machine.enterAmount({ value: 200, unit: "sat" }, MINT1);
  expect(machine.getStep()).toBe("navigateToMeltPreview");
}

async function toPaymentRequest(machine: Machine) {
  await machine.execute(INPUTS.paymentRequestBasic, { reset: true });
  expect(machine.getStep()).toBe("navigateToPaymentRequest");
}

/** Lightning-address flow on the mint list with no mint or amount chosen. */
async function toMintListWithoutMint(machine: Machine) {
  await machine.execute(INPUTS.lightningAddress, { reset: true });
  await machine.requestMintSelector();
  expect(machine.getStep()).toBe("selectMint");
}

// ---------------------------------------------------------------------------
// Early returns
// ---------------------------------------------------------------------------

describe("a turn's early returns", () => {
  it("drops an event that arrives while a resolve runs, and is free once it lands", async () => {
    const quote = deferred<{ historyEntry: string }>();
    const tm = build({ operations: { executeMintQuote: () => quote.promise } });
    await tm.machine.startReceiveLightning({ reset: true });
    const press = tm.machine.enterAmount({ value: 1000, unit: "sat" }, MINT1, {
      destination: "mintQuote",
    });

    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);
    expect(await tm.machine.confirmPaymentRequest()).toEqual({ kind: "ignored" });

    quote.resolve(mintQuoteEntry("q1", 1000));
    await press;
    expect(tm.machine.getStep()).toBe("mintQuoteCreated");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("drops even fresh intent while money moves, and is free once the send lands", async () => {
    const sent = deferred<{ token: string; historyEntry: string }>();
    const hang = () => sent.promise;
    const tm = build({ operations: { executeSend: hang, executeOfflineSend: hang } });
    await tm.machine.startSendEcash({ reset: true });
    const commit = tm.machine.enterAmount({ value: 100, unit: "sat" }, MINT1, {
      destination: "sendEcash",
    });

    await tm.machine.enterAmount({ value: 999, unit: "sat" }, MINT1, {
      destination: "sendEcash",
    });
    expect(tm.machine.getContext().amount).toBe(100);
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);

    sent.resolve({
      token: "cashuAtoken",
      historyEntry: JSON.stringify({
        id: "send-1",
        type: "send",
        createdAt: 1,
        mintUrl: MINT1,
        unit: "sat",
        amount: 100,
        state: "PENDING",
        token: "cashuAtoken",
        metadata: {},
      }),
    });
    await commit;
    expect(tm.machine.getStep()).toBe("sendComplete");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("refuses the mint list from a paid melt preview and stays free", async () => {
    const tm = build();
    await toMeltPreview(tm.machine);
    await tm.machine.confirmMelt();
    const selectors = tm.handled("selectMint");

    await tm.machine.requestMintSelector();

    expect(tm.machine.getStep()).toBe("navigateToMeltPreview");
    expect(tm.handled("selectMint")).toBe(selectors);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("ignores Pay on a paid melt preview and stays free", async () => {
    const tm = build();
    await toMeltPreview(tm.machine);
    await tm.machine.confirmMelt();

    await tm.machine.confirmMelt();

    expect(tm.calls("executeMelt")).toBe(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("ignores Pay and the mint list on a delivered payment request and stays free", async () => {
    const tm = build();
    await toPaymentRequest(tm.machine);
    expect((await tm.machine.confirmPaymentRequest()).kind).toBe("delivered");

    expect(await tm.machine.confirmPaymentRequest()).toEqual({ kind: "ignored" });
    expect(await isFree(tm.machine)).toBe(true);
    await tm.machine.requestMintSelector();
    expect(tm.machine.getStep()).toBe("navigateToPaymentRequest");

    expect(tm.calls("executePaymentRequest")).toBe(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("re-opens the mint list for Pay with no mint chosen and stays free", async () => {
    const tm = build();
    await toMintListWithoutMint(tm.machine);
    const selectors = tm.handled("selectMint");

    await tm.machine.confirmMelt();
    expect(await tm.machine.confirmPaymentRequest()).toEqual({ kind: "ignored" });

    expect(tm.handled("selectMint")).toBe(selectors + 2);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("rejects Pay with no mint chosen when the mint list handler throws, and stays free", async () => {
    let throwing = false;
    const tm = build({
      handlers: {
        selectMint: () => {
          if (throwing) throw new Error("navigation failed");
        },
      },
    });
    await toMintListWithoutMint(tm.machine);
    throwing = true;

    await expect(tm.machine.confirmMelt()).rejects.toThrow("navigation failed");
    await expect(tm.machine.confirmPaymentRequest()).rejects.toThrow("navigation failed");

    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("changes nothing for an event the step does not handle, and stays free", async () => {
    const tm = build();
    await toMeltPreview(tm.machine);
    const handlerCalls = tm.handlerCalls.length;

    expect(await isFree(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(true);

    expect(tm.handlerCalls).toHaveLength(handlerCalls);
    expect(isExecuting(tm.machine)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Superseding
// ---------------------------------------------------------------------------

describe("a turn superseded by fresh intent", () => {
  it("hands the lock to the newer turn; the older one's late result does not free it", async () => {
    const first = deferred<MeltQuotePreview>();
    const second = deferred<MeltQuotePreview>();
    let quotes = 0;
    const tm = build({
      operations: {
        quoteMelt: () => (++quotes === 1 ? first.promise : second.promise),
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    const older = tm.machine.enterAmount({ value: 200, unit: "sat" }, MINT1);
    const newer = tm.machine.enterAmount({ value: 300, unit: "sat" }, MINT1);
    expect(quotes).toBe(2);

    first.resolve(meltQuote());
    await older;
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);
    await tm.machine.confirmMelt();
    expect(tm.calls("executeMelt")).toBe(0);

    second.resolve(meltQuote({ quoteId: "quote-2", quoteAmount: 300, flowAmount: 300 }));
    await newer;
    expect(tm.machine.getContext().amount).toBe(300);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("keeps the newer turn's lock when the older one's handler returns late", async () => {
    const receiveScreen = deferred();
    const amountScreen = deferred();
    const tm = build({
      handlers: {
        receiveToken: () => receiveScreen.promise,
        enterAmount: () => amountScreen.promise,
      },
    });
    const older = tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    await settle();
    expect(tm.handled("receiveToken")).toBe(1);
    const newer = tm.machine.startSendEcash();
    await settle();
    expect(tm.handled("enterAmount")).toBe(1);

    receiveScreen.resolve();
    await older;
    expect(tm.machine.getStep()).toBe("enterAmount");
    expect(await isFree(tm.machine)).toBe(false);

    amountScreen.resolve();
    await newer;
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("keeps the newer turn's lock when a superseded quote refresh lands", async () => {
    const refresh = deferred<MeltQuotePreview>();
    const requote = deferred<MeltQuotePreview>();
    let quotes = 0;
    const tm = build({
      operations: {
        quoteMelt: () => {
          quotes += 1;
          if (quotes === 1) return Promise.resolve(meltQuote({ expiresAt: 1 }));
          return quotes === 2 ? refresh.promise : requote.promise;
        },
      },
    });
    await toMeltPreview(tm.machine);
    const pay = tm.machine.confirmMelt();
    const newer = tm.machine.enterAmount({ value: 300, unit: "sat" }, MINT1);
    expect(quotes).toBe(3);

    refresh.resolve(meltQuote({ quoteId: "quote-2" }));
    await pay;
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);

    requote.resolve(meltQuote({ quoteId: "quote-3", quoteAmount: 300, flowAmount: 300 }));
    await newer;
    expect(tm.calls("executeMelt")).toBe(0);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  // Pay with no mint chosen re-runs the mint list handler. When fresh intent
  // takes over while that handler runs, the newer turn keeps its lock: Pay
  // cannot run while it still waits for its quote.
  it("keeps the newer turn's lock when Pay with no mint chosen is superseded", async () => {
    const selector = deferred();
    let holdSelector = false;
    const quote = deferred<MeltQuotePreview>();
    const tm = build({
      handlers: { selectMint: () => (holdSelector ? selector.promise : undefined) },
      operations: { quoteMelt: () => quote.promise },
    });
    await toMintListWithoutMint(tm.machine);
    holdSelector = true;

    const pay = tm.machine.confirmMelt();
    const newer = tm.machine.enterAmount({ value: 200, unit: "sat" }, MINT1);
    expect(tm.machine.getStep()).toBe("navigateToMeltPreview");
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);

    selector.resolve();
    await pay;
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);
    await tm.machine.confirmMelt();
    expect(tm.calls("executeMelt")).toBe(0);

    quote.resolve(meltQuote());
    await newer;
    expect(tm.machine.getStep()).toBe("navigateToMeltPreview");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  // A confirm tapped on the mint list with no mint chosen sends nothing, so
  // a later confirm's payment is not its outcome.
  it("tells a superseded confirm that sent nothing that it was ignored", async () => {
    const selector = deferred();
    let holdSelector = false;
    const tm = build({
      handlers: { selectMint: () => (holdSelector ? selector.promise : undefined) },
    });
    await toMintListWithoutMint(tm.machine);
    holdSelector = true;

    const first = tm.machine.confirmPaymentRequest();
    await tm.machine.execute(INPUTS.paymentRequestBasic);
    expect(tm.machine.getStep()).toBe("navigateToPaymentRequest");
    const second = await tm.machine.confirmPaymentRequest();
    selector.resolve();

    expect(second.kind).toBe("delivered");
    expect(await first).toEqual({ kind: "ignored" });
    expect(tm.calls("executePaymentRequest")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CONFIRM_MELT
// ---------------------------------------------------------------------------

describe("Pay on a melt preview", () => {
  it("is free and not executing after a paid melt", async () => {
    const tm = build();
    await toMeltPreview(tm.machine);
    await tm.machine.confirmMelt();
    expect(tm.machine.getStep()).toBe("navigateToMeltPreview");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("is free and not executing after a failed melt that stays on the preview", async () => {
    const tm = build({
      operations: {
        executeMelt: async () => {
          throw new Error("route not found");
        },
      },
    });
    await toMeltPreview(tm.machine);
    await tm.machine.confirmMelt();
    expect(tm.machine.getStep()).toBe("navigateToMeltPreview");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("is free after a failed melt moves to the fallback and runs its handler", async () => {
    const tm = build({
      operations: {
        executeMelt: async () => {
          throw new Error("LNURL invoice fetch failed");
        },
        npcAddressForPubkey: () => "npub1recipient@npubx.cash",
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: "sat" }, MINT1, {
      recipientPubkey: "cd".repeat(32),
    });
    await tm.machine.confirmMelt();
    expect(tm.machine.getStep()).toBe("chooseSendFallback");
    expect(tm.handled("chooseSendFallback")).toBe(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("rejects when the next step's handler throws, and stays free", async () => {
    const tm = build({
      handlers: {
        chooseSendFallback: () => {
          throw new Error("sheet failed");
        },
      },
      operations: {
        executeMelt: async () => {
          throw new Error("LNURL invoice fetch failed");
        },
        npcAddressForPubkey: () => "npub1recipient@npubx.cash",
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: "sat" }, MINT1, {
      recipientPubkey: "cd".repeat(32),
    });
    await expect(tm.machine.confirmMelt()).rejects.toThrow("sheet failed");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("is free after refreshing an expired quote, and after the refresh fails", async () => {
    let quotes = 0;
    const tm = build({
      operations: {
        quoteMelt: async () => {
          quotes += 1;
          if (quotes === 3) throw new Error("mint unavailable");
          return meltQuote({ quoteId: `quote-${quotes}`, expiresAt: 1 });
        },
      },
    });
    await toMeltPreview(tm.machine);

    await tm.machine.confirmMelt();
    expect(quotes).toBe(2);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);

    await tm.machine.confirmMelt();
    expect(quotes).toBe(3);
    expect(tm.calls("executeMelt")).toBe(0);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("rejects when the preview handler throws after a refresh, and stays free", async () => {
    let throwing = false;
    const tm = build({
      handlers: {
        navigateToMeltPreview: () => {
          if (throwing) throw new Error("render failed");
        },
      },
      operations: { quoteMelt: async () => meltQuote({ expiresAt: 1 }) },
    });
    await toMeltPreview(tm.machine);
    throwing = true;
    await expect(tm.machine.confirmMelt()).rejects.toThrow("render failed");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  // The throw reaches the caller as before, and nothing was paid; the turn
  // finishes, so the next Pay pays.
  it("is free and pays nothing when a listener throws as the melt starts", async () => {
    const tm = build();
    await toMeltPreview(tm.machine);
    const unsubscribe = throwWhileExecuting(tm.machine);

    await expect(tm.machine.confirmMelt()).rejects.toThrow("render failed");

    expect(tm.calls("executeMelt")).toBe(0);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    unsubscribe();
    await tm.machine.confirmMelt();
    expect(tm.calls("executeMelt")).toBe(1);
  });

  it("is free and asks for no quote when a listener throws as an expired quote refreshes", async () => {
    let quotes = 0;
    const tm = build({
      operations: {
        quoteMelt: async () => {
          quotes += 1;
          return meltQuote({ quoteId: `quote-${quotes}`, expiresAt: 1 });
        },
      },
    });
    await toMeltPreview(tm.machine);
    const unsubscribe = throwWhileExecuting(tm.machine);

    await expect(tm.machine.confirmMelt()).rejects.toThrow("render failed");

    expect(quotes).toBe(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    unsubscribe();
    await tm.machine.confirmMelt();
    expect(quotes).toBe(2);
  });

  // The melt was paid: a link or notification that throws afterwards is
  // logged, and neither keeps the machine held nor lets Pay pay again.
  it("finishes and keeps the melt paid when linking it throws", async () => {
    const tm = build({
      direct: {
        linkTransaction: () => {
          throw new Error("history store closed");
        },
      },
    });
    await toMeltPreview(tm.machine);

    await expect(tm.machine.confirmMelt()).resolves.toBeUndefined();

    expect(tm.notificationCalls.some((c) => c.key === "onPaymentConfirmed")).toBe(true);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    await tm.machine.confirmMelt();
    expect(tm.calls("executeMelt")).toBe(1);
  });

  it("finishes and keeps the melt paid when a notification throws", async () => {
    const tm = build({
      notifications: {
        onPaymentConfirmed: () => {
          throw new Error("toast failed");
        },
      },
    });
    await toMeltPreview(tm.machine);

    await expect(tm.machine.confirmMelt()).resolves.toBeUndefined();

    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    await tm.machine.confirmMelt();
    expect(tm.calls("executeMelt")).toBe(1);
  });

  it("drops a melt that lands after a reset and leaves the newer turn's lock alone", async () => {
    const melt = deferred<{ historyEntry: string }>();
    const quote = deferred<MeltQuotePreview>();
    let quotes = 0;
    const tm = build({
      operations: {
        executeMelt: () => melt.promise,
        quoteMelt: async () => (++quotes === 1 ? meltQuote() : quote.promise),
      },
    });
    await toMeltPreview(tm.machine);
    const pay = tm.machine.confirmMelt();
    expect(await isFree(tm.machine)).toBe(false);

    tm.machine.reset();
    expect(isExecuting(tm.machine)).toBe(false);
    await tm.machine.execute(INPUTS.lightningAddress);
    const newer = tm.machine.enterAmount({ value: 300, unit: "sat" }, MINT1);

    melt.resolve({
      historyEntry: JSON.stringify({ id: "melt-1", type: "melt", state: "PAID" }),
    });
    await pay;
    expect(tm.calls("linkTransaction")).toBe(0);
    expect(tm.notificationCalls.some((c) => c.key === "onPaymentConfirmed")).toBe(false);
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);

    quote.resolve(meltQuote({ quoteAmount: 300, flowAmount: 300 }));
    await newer;
    expect(tm.machine.getContext().amount).toBe(300);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CONFIRM_PAYMENT_REQUEST
// ---------------------------------------------------------------------------

describe("Pay on a payment request", () => {
  async function confirmWith(operations: Partial<MachineOperations>) {
    const tm = build({ operations });
    await toPaymentRequest(tm.machine);
    const outcome = await tm.machine.confirmPaymentRequest();
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    return { tm, outcome };
  }

  it("resolves delivered and is free", async () => {
    const { outcome } = await confirmWith({});
    expect(outcome.kind).toBe("delivered");
  });

  it("resolves failed and is free when the send throws", async () => {
    const { outcome } = await confirmWith({
      executePaymentRequest: async () => {
        throw new Error("Transport down");
      },
    });
    expect(outcome).toEqual({ kind: "failed" });
  });

  it("resolves rolled back and is free when the ecash was taken back", async () => {
    const { outcome } = await confirmWith({
      executePaymentRequest: async () => ({
        historyEntry: JSON.stringify({ id: "pr-1", type: "send", state: "rolledBack" }),
        rolledBack: true,
        errorMessage: "relay refused",
      }),
    });
    expect(outcome).toEqual({ kind: "rolledBack" });
  });

  it("resolves undelivered and is free when the ecash left and was not taken back", async () => {
    const { outcome } = await confirmWith({
      executePaymentRequest: async () => {
        throw new PaymentRequestUndeliveredError("op-9", new Error("relay down"));
      },
    });
    expect(outcome).toEqual({ kind: "undelivered", operationId: "op-9" });
  });

  it("resolves a second tap while the first sends as ignored", async () => {
    const sent = deferred<{ historyEntry: string }>();
    const tm = build({ operations: { executePaymentRequest: () => sent.promise } });
    await toPaymentRequest(tm.machine);
    const first = tm.machine.confirmPaymentRequest();

    expect(await tm.machine.confirmPaymentRequest()).toEqual({ kind: "ignored" });
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);

    sent.resolve({
      historyEntry: JSON.stringify({ id: "pr-1", type: "send", state: "pending" }),
    });
    expect((await first).kind).toBe("delivered");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("resolves ignored when a reset overtakes the send", async () => {
    const sent = deferred<{ historyEntry: string }>();
    const tm = build({ operations: { executePaymentRequest: () => sent.promise } });
    await toPaymentRequest(tm.machine);
    const first = tm.machine.confirmPaymentRequest();

    tm.machine.reset();
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    sent.resolve({
      historyEntry: JSON.stringify({ id: "pr-1", type: "send", state: "pending" }),
    });

    expect(await first).toEqual({ kind: "ignored" });
    expect(tm.machine.getStep()).toBe("idle");
    expect(await isFree(tm.machine)).toBe(true);
  });

  // As for a melt, a link that throws after delivery is logged: the caller
  // still learns the payment was delivered, and Pay does not send again.
  it("resolves delivered and is free when linking the delivered payment throws", async () => {
    const tm = build({
      direct: {
        linkTransaction: () => {
          throw new Error("history store closed");
        },
      },
    });
    await toPaymentRequest(tm.machine);

    expect((await tm.machine.confirmPaymentRequest()).kind).toBe("delivered");

    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    expect(await tm.machine.confirmPaymentRequest()).toEqual({ kind: "ignored" });
    expect(tm.calls("executePaymentRequest")).toBe(1);
  });

  it("is free and sends nothing when a listener throws as the send starts", async () => {
    const tm = build();
    await toPaymentRequest(tm.machine);
    const unsubscribe = throwWhileExecuting(tm.machine);

    await expect(tm.machine.confirmPaymentRequest()).rejects.toThrow("render failed");

    expect(tm.calls("executePaymentRequest")).toBe(0);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    unsubscribe();
    expect((await tm.machine.confirmPaymentRequest()).kind).toBe("delivered");
  });

  // A listener is the subscriber's code: its throw reaches the caller, but
  // only after the step records the delivery and the turn finishes.
  it("is free and keeps the delivery when a listener throws after it", async () => {
    const tm = build();
    await toPaymentRequest(tm.machine);
    tm.machine.subscribe(() => {
      if (tm.calls("executePaymentRequest") > 0) throw new Error("render failed");
    });

    await expect(tm.machine.confirmPaymentRequest()).rejects.toThrow("render failed");

    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    expect(await tm.machine.confirmPaymentRequest()).toEqual({ kind: "ignored" });
    expect(tm.calls("executePaymentRequest")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Main path
// ---------------------------------------------------------------------------

// A notification is the host's fire and forget: what it throws, at once or
// later, is logged, and the payment, the turn and the caller's outcome carry
// on as if it had returned.
describe("a notification that throws", () => {
  const throwing = () => {
    throw new Error("toast failed");
  };
  const rejecting = () => Promise.reject(new Error("toast failed"));

  let unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it.each([
    ["throws", throwing],
    ["rejects", rejecting],
  ])("as a melt starts (%s): pays once, and the machine is free", async (_how, notify) => {
    const tm = build({ notifications: { onPaymentProcessing: notify } });
    await toMeltPreview(tm.machine);

    await expect(tm.machine.confirmMelt()).resolves.toBeUndefined();
    await tm.machine.confirmMelt();
    await settle();

    expect(tm.calls("executeMelt")).toBe(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it.each([
    ["throws", throwing],
    ["rejects", rejecting],
  ])("as a payment request starts (%s): resolves delivered, and the machine is free", async (_how, notify) => {
    const tm = build({ notifications: { onPaymentProcessing: notify } });
    await toPaymentRequest(tm.machine);

    expect((await tm.machine.confirmPaymentRequest()).kind).toBe("delivered");
    await settle();

    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it.each([
    ["throws", throwing],
    ["rejects", rejecting],
  ])("on an undelivered request (%s): resolves undelivered and keeps it so", async (_how, notify) => {
    const tm = build({
      operations: {
        executePaymentRequest: async () => {
          throw new PaymentRequestUndeliveredError("op-9", new Error("relay down"));
        },
      },
      notifications: { onPaymentFailed: notify },
    });
    await toPaymentRequest(tm.machine);

    expect((await tm.machine.confirmPaymentRequest()).kind).toBe("undelivered");
    expect((await tm.machine.confirmPaymentRequest()).kind).toBe("ignored");
    await settle();

    expect(tm.calls("executePaymentRequest")).toBe(1);
    expect(await isFree(tm.machine)).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it.each([
    ["throws", throwing],
    ["rejects", rejecting],
  ])("on a failed melt (%s): stays on the preview, and Pay retries", async (_how, notify) => {
    const tm = build({
      operations: {
        executeMelt: async () => {
          throw new Error("mint said no");
        },
      },
      notifications: { onPaymentFailed: notify },
    });
    await toMeltPreview(tm.machine);

    await expect(tm.machine.confirmMelt()).resolves.toBeUndefined();
    expect(tm.machine.getStep()).toBe("navigateToMeltPreview");
    expect(await isFree(tm.machine)).toBe(true);
    await tm.machine.confirmMelt();
    await settle();

    expect(tm.calls("executeMelt")).toBe(2);
    expect(unhandled).toEqual([]);
  });

  it.each([
    ["throws", throwing],
    ["rejects", rejecting],
  ])("as a scan resolves (%s): still opens the next step, and the machine is free", async (_how, notify) => {
    const tm = build({ notifications: { onScanResolved: notify } });

    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    await settle();

    expect(tm.machine.getStep()).toBe("receiveToken");
    expect(tm.handled("receiveToken")).toBe(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
    expect(unhandled).toEqual([]);
  });
});

describe("the main path", () => {
  it("is free and not executing after a resolve and its handler", async () => {
    const tm = build();
    await tm.machine.startReceiveLightning({ reset: true });
    await tm.machine.enterAmount({ value: 1000, unit: "sat" }, MINT1, {
      destination: "mintQuote",
    });
    expect(tm.machine.getStep()).toBe("mintQuoteCreated");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("swallows a throwing handler and is free afterwards", async () => {
    const tm = build({
      handlers: {
        receiveToken: () => {
          throw new Error("screen failed");
        },
      },
    });
    await expect(
      tm.machine.execute(INPUTS.cashuTokenV3, { reset: true }),
    ).resolves.toBeUndefined();
    expect(tm.machine.getStep()).toBe("receiveToken");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  // An NFC tap that paid records it before linking: a link that throws is
  // logged, the tap completes, and a later Pay sends nothing.
  it("completes an NFC tap that paid when linking it throws", async () => {
    let links = 0;
    const tm = build({
      nfcAdapter: nfcAdapter(),
      direct: {
        linkTransaction: () => {
          if (++links === 1) throw new Error("history store closed");
        },
      },
    });
    await expect(
      tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" }),
    ).resolves.toMatchObject({ urInProgress: false });
    expect(tm.calls("executeNfcSend")).toBe(1);
    expect(tm.machine.getStep()).toBe("sendComplete");
    expect(tm.handled("sendComplete")).toBe(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);

    expect(await tm.machine.confirmPaymentRequest()).toEqual({ kind: "ignored" });
    expect(tm.calls("executePaymentRequest")).toBe(0);
  });

  it("swallows a throwing handler on an input step and is free afterwards", async () => {
    const tm = build({
      handlers: {
        enterAmount: async () => {
          throw new Error("screen failed");
        },
      },
    });
    await expect(tm.machine.startSendEcash({ reset: true })).resolves.toBeUndefined();
    expect(tm.machine.getStep()).toBe("enterAmount");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("is free at once after a reset during a resolve, and the late result changes nothing", async () => {
    const quote = deferred<{ historyEntry: string }>();
    const tm = build({ operations: { executeMintQuote: () => quote.promise } });
    await tm.machine.startReceiveLightning({ reset: true });
    const press = tm.machine.enterAmount({ value: 1000, unit: "sat" }, MINT1, {
      destination: "mintQuote",
    });

    tm.machine.reset();
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);

    quote.resolve(mintQuoteEntry("q1", 1000));
    await press;
    expect(tm.machine.getStep()).toBe("idle");
    expect(tm.handled("mintQuoteCreated")).toBe(0);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("leaves a newer flow's lock alone when a reset resolve lands", async () => {
    const first = deferred<{ historyEntry: string }>();
    const second = deferred<{ historyEntry: string }>();
    let quotes = 0;
    const tm = build({
      operations: {
        executeMintQuote: () => (++quotes === 1 ? first.promise : second.promise),
      },
    });
    await tm.machine.startReceiveLightning({ reset: true });
    const older = tm.machine.enterAmount({ value: 1000, unit: "sat" }, MINT1, {
      destination: "mintQuote",
    });
    await tm.machine.startReceiveLightning({ reset: true });
    const newer = tm.machine.enterAmount({ value: 2000, unit: "sat" }, MINT1, {
      destination: "mintQuote",
    });

    first.reject(new Error("mint exploded"));
    await older;
    expect(tm.machine.getStep()).toBe("createMintQuote");
    expect(isExecuting(tm.machine)).toBe(true);
    expect(await isFree(tm.machine)).toBe(false);

    second.resolve(mintQuoteEntry("q2", 2000));
    await newer;
    expect(tm.machine.getStep()).toBe("mintQuoteCreated");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Order of a turn's bookkeeping
// ---------------------------------------------------------------------------

/**
 * Microtasks from the last time `run`'s turn told listeners anything to the
 * moment its promise settles. Counting restarts at each announcement and
 * stops after a bound, so a turn that waits on a timer is not starved.
 */
async function ticksFromLastAnnouncement(
  machine: Machine,
  run: () => Promise<unknown>,
): Promise<number> {
  let tick = 0;
  let counting = false;
  let settled = false;
  const count = () => {
    tick += 1;
    counting = !settled && tick < 50;
    if (counting) queueMicrotask(count);
  };
  const unsubscribe = machine.subscribe(() => {
    tick = 0;
    if (!counting) {
      counting = true;
      queueMicrotask(count);
    }
  });
  let settledAt = -1;
  await run().then(() => {
    settled = true;
    settledAt = tick;
  });
  unsubscribe();
  return settledAt;
}

describe("the order of a turn's bookkeeping", () => {
  it("logs the safety net before it frees the machine and tells listeners", async () => {
    let throwing = false;
    const tm = build({
      getContext: (wallet) => {
        if (throwing) throw new Error("wallet closed");
        return wallet;
      },
    });
    const sawWarning: boolean[] = [];
    tm.machine.subscribe(() => {
      sawWarning.push(logs.some((line) => line.event === "machine.transition.safetyNet"));
    });

    throwing = true;
    await expect(tm.machine.submitSendMemo()).resolves.toBeUndefined();
    throwing = false;

    expect(sawWarning).toEqual([true]);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("drops an event the unit read sends while a reset still holds the machine", async () => {
    const quote = deferred<{ historyEntry: string }>();
    let reenter: (() => void) | null = null;
    const tm = build({
      operations: { executeMintQuote: () => quote.promise },
      getUnit: () => {
        const run = reenter;
        reenter = null;
        run?.();
        return "sat";
      },
    });
    await tm.machine.startReceiveLightning({ reset: true });
    void tm.machine.enterAmount({ value: 1000, unit: "sat" }, MINT1, {
      destination: "mintQuote",
    });
    expect(await isFree(tm.machine)).toBe(false);

    const from = logs.length;
    reenter = () => void tm.machine.submitSendMemo();
    tm.machine.reset();

    const memo = logs
      .slice(from)
      .filter((line) => line.fields?.type === "SEND_MEMO_SUBMITTED")
      .map((line) => line.event);
    expect(memo).toEqual(["machine.event.ignored"]);
    expect(await isFree(tm.machine)).toBe(true);
    quote.resolve(mintQuoteEntry("q1", 1000));
  });

  // QUIRK: a reset whose unit read throws has stranded the running turn but
  // not yet freed the machine, so it stays held until the next reset.
  it("leaves the machine held when the unit read throws during a reset", async () => {
    const quote = deferred<{ historyEntry: string }>();
    let unitThrows = false;
    const tm = build({
      operations: { executeMintQuote: () => quote.promise },
      getUnit: () => {
        if (unitThrows) throw new Error("settings closed");
        return "sat";
      },
    });
    await tm.machine.startReceiveLightning({ reset: true });
    const press = tm.machine.enterAmount({ value: 1000, unit: "sat" }, MINT1, {
      destination: "mintQuote",
    });

    unitThrows = true;
    expect(() => tm.machine.reset()).toThrow("settings closed");
    unitThrows = false;
    quote.resolve(mintQuoteEntry("q1", 1000));
    await press;

    expect(tm.machine.getStep()).toBe("createMintQuote");
    expect(await isFree(tm.machine)).toBe(false);
    tm.machine.reset();
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("settles Pay on a melt preview in the microtask after its last announcement", async () => {
    const tm = build();
    await toMeltPreview(tm.machine);
    expect(await ticksFromLastAnnouncement(tm.machine, () => tm.machine.confirmMelt())).toBe(1);
    expect(tm.calls("executeMelt")).toBe(1);
  });

  it("settles Pay on a payment request in the microtask after its last announcement", async () => {
    const tm = build();
    await toPaymentRequest(tm.machine);
    expect(
      await ticksFromLastAnnouncement(tm.machine, () =>
        tm.machine.send({ type: "CONFIRM_PAYMENT_REQUEST" }),
      ),
    ).toBe(1);
    expect(tm.calls("executePaymentRequest")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// NFC auto-resolve
// ---------------------------------------------------------------------------

/** 1000-sat bolt11 (10u); the same invoice nfc-machine.test.ts taps. */
const NFC_TAG_INVOICE =
  "lnbc10u1p4pcn75pp5nx5zweympssrmvmecek6n3ynhj7emfe3dynls8q3yu62uhje9rksdqqcqzzsxqyz5vqsp5lersjjw2atsnqhzhqac00xvvcelcw6gqfy7u2jka25q9y2dhczns9qxpqysgqckuv826yw544mrwgnt6k0r529wrczsj03hwrtgg0ch4gewreqt75gg838wrd6twg5dp7n9m9eze6km22svvx8jq5jmrv4pvr0q4dffqpp0ftc3";

function nfcAdapter(overrides?: Partial<NfcIOAdapter>) {
  return {
    readPaymentRequest: vi.fn(async () => INPUTS.paymentRequestBasic),
    writeToken: vi.fn(async (_token: string) => {}),
    releaseSession: vi.fn(async () => {}),
    isAvailable: vi.fn(async () => true),
    ...overrides,
  };
}

describe("an NFC tap", () => {
  it("is free and not executing after it pays the request and writes back", async () => {
    const adapter = nfcAdapter();
    const tm = build({ nfcAdapter: adapter });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    expect(tm.machine.getStep()).toBe("sendComplete");
    expect(adapter.writeToken).toHaveBeenCalledTimes(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("is free and not executing after the write-back fails", async () => {
    const adapter = nfcAdapter({
      writeToken: vi.fn(async () => {
        throw new Error("tag lost");
      }),
    });
    const tm = build({ nfcAdapter: adapter });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });
    expect(tm.machine.getStep()).toBe("error");
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  it("is free after an invoice tag parks on the preview and releases the session", async () => {
    const adapter = nfcAdapter();
    const tm = build({
      nfcAdapter: adapter,
      wallet: { mintBalances: { [MINT1]: 1500, [MINT2]: 2000 } },
    });
    await tm.machine.scan!(NFC_TAG_INVOICE, { source: "nfc" });
    expect(tm.machine.getStep()).toBe("navigateToMeltPreview");
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });

  // The token is on the tag: the request is paid even when the session then
  // fails to close, and nothing takes the ecash back or sends it again.
  it("records the payment when the session fails to close after the write", async () => {
    const adapter = nfcAdapter({
      releaseSession: vi.fn(async () => {
        throw new Error("session already gone");
      }),
    });
    const rollbackSend = vi.fn(async () => ({ kind: "reclaimed" as const }));
    const tm = build({ nfcAdapter: adapter, operations: { rollbackSend } });
    await tm.machine.scan!(INPUTS.paymentRequestBasic, { source: "nfc" });

    expect(tm.machine.getStep()).toBe("sendComplete");
    expect(rollbackSend).not.toHaveBeenCalled();
    await tm.machine.requestMintSelector();
    await tm.machine.confirmPaymentRequest();
    expect(tm.calls("executeNfcSend") + tm.calls("executePaymentRequest")).toBe(1);
    expect(await isFree(tm.machine)).toBe(true);
  });

  // A reset while the tag session is released strands the tap: it runs no
  // handler and leaves `inspect()` and the lock to the reset.
  it("does nothing more after a reset while it releases the session", async () => {
    const released = deferred();
    const adapter = nfcAdapter({ releaseSession: vi.fn(() => released.promise) });
    const tm = build({
      nfcAdapter: adapter,
      wallet: { mintBalances: { [MINT1]: 1500, [MINT2]: 2000 } },
    });
    const tap = tm.machine.scan!(NFC_TAG_INVOICE, { source: "nfc" });
    await settle();
    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);

    tm.machine.reset();
    expect(isExecuting(tm.machine)).toBe(false);
    released.resolve();
    await tap;

    expect(tm.machine.getStep()).toBe("idle");
    expect(tm.handled("idle")).toBe(0);
    expect(isExecuting(tm.machine)).toBe(false);
    expect(await isFree(tm.machine)).toBe(true);
  });
});
