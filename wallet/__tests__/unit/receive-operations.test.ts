/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * receive-operations.test.ts — receive and mint quote through Coco's records
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `createExecuteReceive` and `createExecuteMintQuote` hand back the history
 * row Coco saved, report a receive that cannot reach the mint as pending, and
 * never accept a token offline that could not be checked offline.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Amount, type Proof } from "@cashu/cashu-ts";
import type { Manager } from "@cashu/coco-core";

import {
  createExecuteMintQuote,
  createExecuteReceive,
} from "../../src/operations/receiveOperations";

const MINT_URL = "https://mint.example";
const TOKEN = "invalid-token-for-metadata-only";

function receiveManager(options: { execute?: "fails" | "finalizes" } = {}) {
  const proof: Proof = {
    id: "00",
    amount: Amount.from(1),
    C: `02${"1".repeat(64)}`,
    secret: "offline-proof",
  };
  const prepared = {
    id: "receive-op",
    state: "prepared",
    mintUrl: MINT_URL,
    unit: "sat",
    amount: Amount.from(1),
    inputProofs: [proof],
    fee: Amount.from(0),
    outputData: { keep: [], send: [] },
    createdAt: 1,
    updatedAt: 1,
  };
  const saved = {
    id: "receive:receive-op",
    type: "receive",
    mintUrl: MINT_URL,
    unit: "sat",
    amount: 1,
    operationId: "receive-op",
  };
  const finalizes = options.execute === "finalizes";
  const api = {
    history: {
      getPaginatedHistory: vi.fn().mockResolvedValue([]),
      getHistoryEntryById: vi.fn().mockResolvedValue(finalizes ? saved : null),
    },
    ops: {
      receive: {
        prepare: vi.fn().mockResolvedValue(prepared),
        execute: finalizes
          ? vi.fn().mockResolvedValue({ ...prepared, state: "finalized" })
          : vi.fn().mockRejectedValue(new Error("network unavailable")),
        get: vi.fn().mockResolvedValue({ ...prepared, state: "executing" }),
      },
    },
  };
  return { api, manager: api as unknown as Manager, prepared, saved };
}

function receive(
  manager: Manager,
  verifyOfflineReceive: (manager: Manager, prepared: unknown) => Promise<void>,
  getOffline?: () => boolean,
) {
  return createExecuteReceive({
    getManager: () => manager,
    getOffline,
    verifyOfflineReceive,
    pendingMessage: "Waiting for the mint",
    newLocalId: (prefix) => `${prefix}-local`,
  });
}

describe("createExecuteReceive", () => {
  it("returns the history row Coco saved when the receive finalizes", async () => {
    const { manager, saved } = receiveManager({ execute: "finalizes" });
    const result = await receive(manager, async () => {})({ tokenString: TOKEN, mintUrl: MINT_URL, amount: 1 });

    expect(result).toMatchObject({ status: "finalized" });
    expect(JSON.parse((result as { historyEntry: string }).historyEntry)).toEqual(saved);
  });

  it("checks the token offline before it asks the mint for anything", async () => {
    const { api, manager, prepared } = receiveManager();
    const verify = vi.fn().mockResolvedValue(undefined);

    await expect(receive(manager, verify)({ tokenString: TOKEN, mintUrl: MINT_URL, amount: 1 })).resolves.toMatchObject({
      status: "pending",
      operationId: "receive-op",
      pendingReason: "network",
      message: "Waiting for the mint",
    });
    expect(verify).toHaveBeenCalledWith(manager, prepared);
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(
      api.ops.receive.execute.mock.invocationCallOrder[0],
    );
  });

  it("does not report a receive as pending when the token could not be checked offline", async () => {
    const { manager, prepared } = receiveManager();
    const verificationError = new Error("offline verification rejected");
    const verify = vi.fn().mockRejectedValue(verificationError);

    await expect(receive(manager, verify)({ tokenString: TOKEN, mintUrl: MINT_URL, amount: 1 })).rejects.toBe(verificationError);
    expect(verify).toHaveBeenCalledWith(manager, prepared);
  });

  it("refuses before asking the mint when the phone is already offline", async () => {
    const { api, manager } = receiveManager();
    const verificationError = new Error("offline verification rejected");
    const verify = vi.fn().mockRejectedValue(verificationError);

    await expect(receive(manager, verify, () => true)({ tokenString: TOKEN, mintUrl: MINT_URL, amount: 1 })).rejects.toBe(
      verificationError,
    );
    expect(api.ops.receive.execute).not.toHaveBeenCalled();
  });

  it("fails a receive the mint turned down, instead of leaving it pending", async () => {
    const { api, manager } = receiveManager();
    const refused = new Error("Token already spent");
    api.ops.receive.execute.mockRejectedValue(refused);
    api.ops.receive.get.mockResolvedValue({ id: "receive-op", state: "failed", mintUrl: MINT_URL });

    await expect(receive(manager, async () => {})({ tokenString: TOKEN, mintUrl: MINT_URL, amount: 1 })).rejects.toBe(refused);
  });

  it("says so when there is no wallet", async () => {
    const execute = createExecuteReceive({
      getManager: () => null,
      verifyOfflineReceive: async () => {},
      pendingMessage: "",
      newLocalId: (prefix) => prefix,
    });
    await expect(execute({ tokenString: TOKEN, mintUrl: MINT_URL, amount: 1 })).rejects.toThrow("Wallet manager is not available");
  });
});

describe("createExecuteMintQuote", () => {
  afterEach(() => vi.useRealTimers());

  const prepared = {
    id: "mint-op",
    quoteId: "quote-1",
    createdAt: 10,
    mintUrl: MINT_URL,
    unit: "sat",
    amount: Amount.from(21),
    request: "lnbc1fixture",
  };

  function quoteManager(rows: unknown[]) {
    const api = { history: { getPaginatedHistory: vi.fn().mockResolvedValue(rows) } };
    return { api, manager: api as unknown as Manager };
  }

  it("asks for the method it was given and returns the row Coco saved for that quote", async () => {
    const saved = {
      id: "mint:saved-id",
      type: "mint",
      mintUrl: MINT_URL,
      unit: "sat",
      quoteId: "quote-1",
      amount: Amount.from(21),
      state: "UNPAID",
      createdAt: 10,
      updatedAt: 10,
    };
    const { manager } = quoteManager([saved]);
    const prepareMintQuote = vi.fn().mockResolvedValue(prepared);
    const execute = createExecuteMintQuote({ getManager: () => manager, prepareMintQuote });

    const result = await execute({ mintUrl: MINT_URL, amount: 21, unit: "sat", method: "onchain" });

    expect(prepareMintQuote).toHaveBeenCalledWith(manager, "onchain", MINT_URL, 21, "sat");
    expect(JSON.parse(result.historyEntry)).toMatchObject({ id: "mint:saved-id", quoteId: "quote-1" });
  });

  it("falls back to an entry built from the quote when the row never appears", async () => {
    vi.useFakeTimers();
    const { manager } = quoteManager([]);
    const execute = createExecuteMintQuote({
      getManager: () => manager,
      prepareMintQuote: vi.fn().mockResolvedValue(prepared),
    });

    const pending = execute({ mintUrl: MINT_URL, amount: 21, unit: "sat" });
    await vi.advanceTimersByTimeAsync(11_000);

    expect(JSON.parse((await pending).historyEntry)).toMatchObject({
      id: "mint-op",
      type: "mint",
      quoteId: "quote-1",
      state: "UNPAID",
      amount: 21,
      paymentRequest: "lnbc1fixture",
    });
  });
});
