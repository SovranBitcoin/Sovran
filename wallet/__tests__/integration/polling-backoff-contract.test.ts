import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Amount,
  initializeCoco,
  MemoryRepositories,
  mintQuoteFromBolt11Response,
  type Manager,
} from "@cashu/coco-core";

const mintUrl = "https://polling-test.invalid";
const quote = {
  quote: "pending-test-quote",
  request: "test-invoice",
  unit: "sat",
  amount: 10,
  state: "UNPAID" as const,
  expiry: null,
};
let manager: Manager;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  vi.stubGlobal("WebSocket", undefined);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(Math, "random").mockReturnValue(0);
  const repo = new MemoryRepositories();
  await repo.mintRepository.addNewMint({
    mintUrl,
    name: "Polling fixture",
    trusted: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mintInfo: {
      name: "Polling fixture",
      pubkey: "",
      version: "test",
      contact: [],
      nuts: {
        "4": { methods: [], disabled: false },
        "5": { methods: [], disabled: false },
      },
    },
  });
  await repo.mintQuoteRepository.upsertMintQuote(
    mintQuoteFromBolt11Response(mintUrl, {
      ...quote,
      amount: Amount.from(10),
      amount_paid: Amount.zero(),
      amount_issued: Amount.zero(),
      method: "bolt11",
      updated_at: null,
    }),
  );
  manager = await initializeCoco({
    repo,
    seedGetter: async () => new Uint8Array(64).fill(9),
    watchers: {
      mintOperationWatcher: { disabled: true },
      proofStateWatcher: { disabled: true },
      meltQuoteWatcher: { disabled: true },
    },
    processors: {
      mintOperationProcessor: { disabled: true },
      meltSettlementProcessor: { disabled: true },
    },
    subscriptions: { fastPollingIntervalMs: 1000, slowPollingIntervalMs: 1000 },
  });
});

afterEach(async () => {
  await manager?.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("honors Retry-After on returned quote failures and delivers a later paid observation", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response("{}", { status: 429, headers: { "Retry-After": "30" } }),
  );
  fetchMock.mockImplementation(async () =>
    Response.json({
      ...quote,
      state: "PAID",
      amount_paid: 10,
      amount_issued: 0,
    }),
  );
  const notify = vi.fn();
  await manager.subscriptions.subscribe(
    mintUrl,
    "bolt11_mint_quote",
    [quote.quote],
    notify,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ state: "PAID" }),
  );
  expect(
    (
      await manager.quotes.mint.get({ mintUrl, quoteId: quote.quote })
    )?.amountPaid.toString(),
  ).toBe("10");
});

it("increases retries for repeated failures, preserves the quote, and resumes normal polling after recovery", async () => {
  fetchMock.mockImplementation(async () => Response.json({}, { status: 429 }));
  await manager.subscriptions.subscribe(mintUrl, "bolt11_mint_quote", [
    quote.quote,
  ]);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3999);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    (
      await manager.quotes.mint.get({ mintUrl, quoteId: quote.quote })
    )?.amountPaid.toString(),
  ).toBe("0");
  fetchMock.mockImplementation(async () =>
    Response.json({ ...quote, amount_paid: 0, amount_issued: 0 }),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("keeps cooldown across pause/resume and cancels it when the mint closes", async () => {
  fetchMock.mockImplementation(
    async () =>
      new Response("{}", { status: 429, headers: { "Retry-After": "30" } }),
  );
  await manager.subscriptions.subscribe(mintUrl, "bolt11_mint_quote", [
    quote.quote,
  ]);
  await vi.advanceTimersByTimeAsync(0);
  manager.subscriptions.pause();
  await vi.advanceTimersByTimeAsync(10_000);
  manager.subscriptions.resume();
  await vi.advanceTimersByTimeAsync(19_999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  manager.subscriptions.closeMint(mintUrl);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not restart polling when a request finishes after teardown", async () => {
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await manager.subscriptions.subscribe(mintUrl, "bolt11_mint_quote", [
    quote.quote,
  ]);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  manager.subscriptions.closeMint(mintUrl);
  finish(new Response("{}", { status: 429 }));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("retries thrown proof-state network failures without dropping the subscription", async () => {
  fetchMock.mockRejectedValueOnce(new Error("temporary network failure"));
  fetchMock.mockImplementation(async () =>
    Response.json({ states: [{ Y: "proof-state-fixture", state: "UNSPENT" }] }),
  );
  const notify = vi.fn();
  await manager.subscriptions.subscribe(
    mintUrl,
    "proof_state",
    ["proof-state-fixture"],
    notify,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalled();
});

it("does not let a new subscription bypass an existing mint cooldown", async () => {
  fetchMock.mockImplementation(
    async () =>
      new Response("{}", {
        status: 429,
        headers: { "Retry-After": new Date(Date.now() + 60_000).toUTCString() },
      }),
  );
  await manager.subscriptions.subscribe(mintUrl, "bolt11_mint_quote", [
    quote.quote,
  ]);
  await vi.advanceTimersByTimeAsync(0);
  await manager.subscriptions.subscribe(mintUrl, "bolt11_mint_quote", [
    "another-pending-quote",
  ]);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not retain a proof polling timer after the last subscriber leaves during a request", async () => {
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const subscription = await manager.subscriptions.subscribe(
    mintUrl,
    "proof_state",
    ["proof-state-fixture"],
  );
  await vi.advanceTimersByTimeAsync(0);
  await subscription.unsubscribe();
  finish(Response.json({ states: [] }));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
