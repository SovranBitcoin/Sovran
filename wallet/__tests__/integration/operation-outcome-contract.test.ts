/**
 * What the wallet's operation functions hand back to the payment machine for
 * send, receive, mint and melt, run against the installed Coco Manager with
 * in-memory repositories and a synthetic mint behind `fetch`: on success, on a
 * mint refusal (HTTP 400), and on a transport error before or after the mint
 * did the work. Also what the person's balance and Coco's history then show,
 * and that no failure leads to a second swap or melt request.
 */
import {
  Amount,
  PaymentRequest,
  PaymentRequestTransportType,
  createBlindSignature,
  deriveKeysetId,
  getEncodedToken,
  hashToCurve,
  pointFromHex,
} from "@cashu/cashu-ts";
import {
  initializeCoco,
  MemoryRepositories,
  type CoreProof,
  type Manager,
} from "@cashu/coco-core";
import { nip19 } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultOperations } from "../../src/operations/defaultOperations";
import {
  createExecuteMintQuote,
  createExecuteReceive,
} from "../../src/operations/receiveOperations";

const MINT_URL = "https://outcome-contract.test";
const MINT_KEY = new Uint8Array(32);
MINT_KEY[31] = 1;
const PUBLIC_KEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const KEYPAIRS = Object.fromEntries(
  [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048].map((a) => [
    String(a),
    PUBLIC_KEY,
  ]),
);
const KEYSET = deriveKeysetId(KEYPAIRS, { unit: "sat", input_fee_ppk: 0 });
const INVOICE =
  "lnbc10u1p4pcn75pp5nx5zweympssrmvmecek6n3ynhj7emfe3dynls8q3yu62uhje9rksdqqcqzzsxqyz5vqsp5lersjjw2atsnqhzhqac00xvvcelcw6gqfy7u2jka25q9y2dhczns9qxpqysgqckuv826yw544mrwgnt6k0r529wrczsj03hwrtgg0ch4gewreqt75gg838wrd6twg5dp7n9m9eze6km22svvx8jq5jmrv4pvr0q4dffqpp0ftc3";

type Fault = "refuse" | "down" | "lost";
type Route =
  | "swap"
  | "mintQuote"
  | "meltQuote"
  | "melt"
  | "checkstate"
  | "meltQuoteState"
  | "mintQuoteState";

function sign(outputs: { amount: number; B_: string }[]) {
  return outputs.map((output) => ({
    id: KEYSET,
    amount: output.amount,
    C_: createBlindSignature(
      pointFromHex(output.B_),
      MINT_KEY,
      KEYSET,
    ).C_.toHex(true),
  }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeOf(url: string): Route | null {
  if (url.endsWith("/v1/swap")) return "swap";
  if (url.endsWith("/v1/mint/quote/bolt11")) return "mintQuote";
  if (url.endsWith("/v1/melt/quote/bolt11")) return "meltQuote";
  if (url.endsWith("/v1/melt/bolt11")) return "melt";
  if (url.endsWith("/v1/checkstate")) return "checkstate";
  if (url.includes("/v1/melt/quote/bolt11/")) return "meltQuoteState";
  if (url.includes("/v1/mint/quote/bolt11/")) return "mintQuoteState";
  return null;
}

function yOf(secret: string): string {
  return hashToCurve(new TextEncoder().encode(secret)).toHex(true);
}

/**
 * One keyset whose every amount is signed with private key 1. It keeps the
 * set of spent inputs so a state check answers the way a real mint would.
 * A fault armed on a route applies to the next request on it:
 *  - refuse: HTTP 400 with a NUT error body, nothing changes at the mint;
 *  - down: the request never arrives and the mint stays unreachable;
 *  - lost: the mint does the work, then the connection drops before the reply.
 */
function syntheticMint() {
  const faults: Partial<Record<Route, Fault>> = {};
  const spent = new Set<string>();
  let down = false;
  let meltPaid = false;
  const calls: string[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const route = routeOf(url);
      if (!route) throw new Error(`Unexpected mint request: ${url}`);
      calls.push(route);
      const fault = faults[route];
      delete faults[route];
      if (fault === "down") down = true;
      if (down) throw new TypeError("Network request failed");
      if (fault === "refuse")
        return json({ detail: `refused ${route}`, code: 11001 }, 400);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const spend = (inputs: { secret: string }[]) => {
        for (const each of inputs) spent.add(yOf(each.secret));
      };
      let reply: Response;
      switch (route) {
        case "swap":
          spend(body.inputs);
          reply = json({ signatures: sign(body.outputs) });
          break;
        case "mintQuote":
          reply = json({
            quote: "mint-quote-1",
            request: "lnbc-synthetic-mint-invoice",
            amount: body.amount,
            unit: "sat",
            state: "UNPAID",
            expiry,
          });
          break;
        case "mintQuoteState":
          reply = json({
            quote: "mint-quote-1",
            request: "lnbc-synthetic-mint-invoice",
            amount: 21,
            unit: "sat",
            state: "UNPAID",
            expiry,
          });
          break;
        case "meltQuote":
        case "meltQuoteState":
          reply = json({
            quote: "melt-quote-1",
            request: INVOICE,
            amount: 10,
            unit: "sat",
            fee_reserve: 2,
            state: meltPaid ? "PAID" : "UNPAID",
            expiry,
            payment_preimage: meltPaid ? "00".repeat(32) : null,
            change: meltPaid ? [] : undefined,
          });
          break;
        case "melt":
          spend(body.inputs);
          meltPaid = true;
          reply = json({
            quote: body.quote,
            request: INVOICE,
            amount: 10,
            unit: "sat",
            fee_reserve: 2,
            state: "PAID",
            expiry,
            payment_preimage: "00".repeat(32),
            change: [],
          });
          break;
        case "checkstate":
          reply = json({
            states: (body.Ys as string[]).map((Y) => ({
              Y,
              state: spent.has(Y) ? "SPENT" : "UNSPENT",
              witness: null,
            })),
          });
          break;
      }
      if (fault === "lost") throw new TypeError("Network request failed");
      return reply;
    },
  );
  return { faults, calls, fetchMock };
}

function proof(secret: string, amount: number): CoreProof {
  return {
    id: KEYSET,
    amount: Amount.from(amount),
    secret,
    C: PUBLIC_KEY,
    mintUrl: MINT_URL,
    unit: "sat",
    state: "ready",
  };
}

async function harness(amounts: number[] = [64, 32, 4]) {
  const repos = new MemoryRepositories();
  const now = Math.floor(Date.now() / 1000);
  const bolt11 = {
    method: "bolt11",
    unit: "sat",
    method_name: null,
    min_amount: null,
    max_amount: null,
  };
  await repos.mintRepository.addNewMint({
    mintUrl: MINT_URL,
    name: "Outcome contract mint",
    trusted: true,
    createdAt: now,
    updatedAt: now,
    mintInfo: {
      name: "Outcome contract mint",
      pubkey: PUBLIC_KEY,
      version: "test",
      contact: [],
      nuts: {
        "4": { methods: [bolt11], disabled: false },
        "5": { methods: [bolt11], disabled: false },
      },
    },
  });
  await repos.keysetRepository.addKeyset({
    mintUrl: MINT_URL,
    id: KEYSET,
    unit: "sat",
    keypairs: KEYPAIRS,
    active: true,
    feePpk: 0,
  });
  await repos.proofRepository.saveProofs(
    MINT_URL,
    amounts.map((a, i) => proof(`own-${i}-${a}`, a)),
  );
  const mint = syntheticMint();
  vi.stubGlobal("fetch", mint.fetchMock);
  const manager = await initializeCoco({
    repo: repos,
    seedGetter: async () => new Uint8Array(64).fill(7),
    watchers: {
      mintOperationWatcher: { disabled: true },
      proofStateWatcher: { disabled: true },
      meltQuoteWatcher: { disabled: true },
    },
    processors: {
      mintOperationProcessor: { disabled: true },
      meltSettlementProcessor: { disabled: true },
    },
  });
  managers.push(manager);
  const ops = createDefaultOperations({ getManager: () => manager });
  return { manager, repos, mint, ops };
}

/** What the person sees on the balance for this mint. */
async function balance(manager: Manager) {
  const byMint = await manager.wallet.balances.byMint({ units: ["sat"] });
  const row = byMint[MINT_URL];
  return {
    spendable: Number(row?.spendable.toString() ?? 0),
    reserved: Number(row?.reserved.toString() ?? 0),
  };
}

async function inflightSats(repos: MemoryRepositories): Promise<number> {
  const inflight = await repos.proofRepository.getInflightProofs([MINT_URL]);
  return inflight.reduce((sum, p) => sum + Number(p.amount.toString()), 0);
}

/** Coco's own history rows: [type, state]. */
async function historyRows(manager: Manager) {
  const rows = await manager.history.getPaginatedHistory(0, 10);
  return rows.map((row) => [row.type, row.state]);
}

async function onlyOperationId(manager: Manager): Promise<string> {
  const rows = await manager.history.getPaginatedHistory(0, 10);
  expect(rows).toHaveLength(1);
  return (rows[0] as { operationId: string }).operationId;
}

const managers: Manager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.dispose();
  vi.unstubAllGlobals();
});

function incomingToken(amount = 8): string {
  return getEncodedToken({
    mint: MINT_URL,
    unit: "sat",
    proofs: [
      {
        id: KEYSET,
        amount: Amount.from(amount),
        secret: `incoming-${amount}`,
        C: PUBLIC_KEY,
      },
    ],
  });
}

function appReceive(manager: Manager, verify = async () => {}) {
  return createExecuteReceive({
    getManager: () => manager,
    verifyOfflineReceive: verify,
    pendingMessage: "Waiting for the mint",
    newLocalId: (prefix) => `${prefix}-local`,
  });
}

/** Quote then prepare, the way the app's bolt11 mint-quote preparer does. */
function appMintQuote(manager: Manager) {
  return createExecuteMintQuote({
    getManager: () => manager,
    prepareMintQuote: async (m, _method, mintUrl, amount, unit) => {
      const quote = await m.quotes.mint.create({
        mintUrl,
        method: "bolt11",
        amount: { amount, unit: unit ?? "sat" },
      });
      const op = await m.ops.mint.prepare({ quote, amount });
      return {
        id: op.id,
        quoteId: op.quoteId,
        createdAt: op.createdAt,
        mintUrl: op.mintUrl,
        unit: op.unit,
        amount: op.amount,
        request: quote.request,
      };
    },
  });
}

const MELT_INPUT = {
  mintUrl: MINT_URL,
  meltTarget: INVOICE,
  amount: 10,
  unit: "sat",
};

describe("send: executeSend against a real Coco Manager", () => {
  it("returns Coco's pending send row with a 10 sat token and swaps once", async () => {
    const { manager, mint, ops } = await harness();

    const result = await ops.executeSend!({ mintUrl: MINT_URL, amount: 10 });

    const entry = JSON.parse(result.historyEntry);
    const operationId = await onlyOperationId(manager);
    expect(entry).toMatchObject({
      id: `send:${operationId}`,
      type: "send",
      state: "pending",
      operationId,
      mintUrl: MINT_URL,
      unit: "sat",
      // QUIRK: the send entry carries Coco's Amount stringified ("10"), while
      // the melt and mint-quote entries below carry plain numbers.
      amount: "10",
    });
    const tokenSats = entry.token.proofs.reduce(
      (sum: number, p: { amount: string }) => sum + Number(p.amount),
      0,
    );
    expect(tokenSats).toBe(10);
    expect(mint.calls).toEqual(["swap"]);
    expect(await balance(manager)).toEqual({ spendable: 90, reserved: 0 });
  });

  it("rejects with the mint's error on a refusal and gives the reserved proofs back", async () => {
    const { manager, mint, ops } = await harness();
    mint.faults.swap = "refuse";

    await expect(
      ops.executeSend!({ mintUrl: MINT_URL, amount: 10 }),
    ).rejects.toMatchObject({ name: "MintOperationError", code: 11001 });

    expect(await historyRows(manager)).toEqual([["send", "rolled_back"]]);
    expect(await balance(manager)).toEqual({ spendable: 100, reserved: 0 });
    expect(mint.calls).toEqual(["swap", "checkstate"]);
  });

  it.each(["down", "lost"] as const)(
    "rejects with a NetworkError when the swap reply never comes (%s) and does not swap again",
    async (fault) => {
      const { manager, mint, ops } = await harness();
      mint.faults.swap = fault;

      await expect(
        ops.executeSend!({ mintUrl: MINT_URL, amount: 10 }),
      ).rejects.toMatchObject({ name: "NetworkError" });

      // QUIRK: nothing undoes an uncertain swap here (the rescue's cancel
      // fails on an executing send), so the send stays "executing" with its
      // 32 sat input reserved until recovery runs, whether or not the mint
      // actually did the swap.
      const operationId = await onlyOperationId(manager);
      expect((await manager.ops.send.get(operationId))?.state).toBe(
        "executing",
      );
      expect(await historyRows(manager)).toEqual([["send", "executing"]]);
      expect(await balance(manager)).toEqual({ spendable: 68, reserved: 32 });
      expect(mint.calls).toEqual(["swap", "checkstate"]);
    },
  );
});

describe("payment request over Nostr: executePaymentRequest against a real Coco Manager", () => {
  function nostrRequest(): string {
    return new PaymentRequest(
      [
        {
          type: PaymentRequestTransportType.NOSTR,
          target: nip19.nprofileEncode({ pubkey: "ee".repeat(32) }),
          tags: [["n", "17"]],
        },
      ],
      "request-1",
      10,
      "sat",
      [MINT_URL],
    ).toEncodedRequest();
  }

  it("gives the reserved proofs back when the send fails before Coco starts it", async () => {
    const { manager, repos, mint } = await harness();
    const sendNostrDM = vi.fn().mockResolvedValue(undefined);
    const ops = createDefaultOperations({
      getManager: () => manager,
      sendNostrDM,
    });
    // Coco's first write of an execute marks the send "executing". When that
    // write fails nothing has started: the send is still "prepared", with its
    // proofs reserved, and Coco's own recovery has nothing to undo.
    const update = repos.sendOperationRepository.update.bind(
      repos.sendOperationRepository,
    );
    vi.spyOn(repos.sendOperationRepository, "update").mockImplementation(
      async (operation) => {
        if (operation.state === "executing") throw new Error("database is locked");
        return update(operation);
      },
    );

    await expect(
      ops.executePaymentRequest!({
        mintUrl: MINT_URL,
        paymentRequest: nostrRequest(),
        amount: 10,
        unit: "sat",
      }),
    ).rejects.toThrow("database is locked");

    expect(sendNostrDM).not.toHaveBeenCalled();
    expect(mint.calls).toEqual([]);
    expect(await historyRows(manager)).toEqual([["send", "rolled_back"]]);
    expect(await balance(manager)).toEqual({ spendable: 100, reserved: 0 });
  });
});

describe("receive: the app's createExecuteReceive against a real Coco Manager", () => {
  it("returns finalized with Coco's own receive row and credits the wallet", async () => {
    const { manager, mint } = await harness([]);

    const result = await appReceive(manager)({
      tokenString: incomingToken(),
      mintUrl: MINT_URL,
      amount: 8,
    } as never);

    const operationId = await onlyOperationId(manager);
    expect(result).toMatchObject({ status: "finalized", hadP2PKProofs: false });
    expect(JSON.parse(result.historyEntry)).toMatchObject({
      id: `receive:${operationId}`,
      type: "receive",
      state: "finalized",
      operationId,
      // QUIRK: stringified Amount, as for send.
      amount: "8",
    });
    expect(mint.calls).toEqual(["swap"]);
    expect(await balance(manager)).toEqual({ spendable: 8, reserved: 0 });
  });

  it("rejects with the mint's error on a refusal and credits nothing", async () => {
    const { manager, mint } = await harness([]);
    mint.faults.swap = "refuse";

    await expect(
      appReceive(manager)({
        tokenString: incomingToken(),
        mintUrl: MINT_URL,
        amount: 8,
      } as never),
    ).rejects.toMatchObject({ name: "MintOperationError", code: 11001 });

    expect(await historyRows(manager)).toEqual([["receive", "rolled_back"]]);
    expect(await balance(manager)).toEqual({ spendable: 0, reserved: 0 });
  });

  it.each(["down", "lost"] as const)(
    "returns pending with a synthetic receive- entry when the swap reply never comes (%s)",
    async (fault) => {
      const { manager, mint } = await harness([]);
      mint.faults.swap = fault;
      const token = incomingToken();

      const result = await appReceive(manager)({
        tokenString: token,
        mintUrl: MINT_URL,
        amount: 8,
      } as never);

      expect(result).toMatchObject({
        status: "pending",
        pendingReason: "network",
        message: "Waiting for the mint",
        hadP2PKProofs: false,
      });
      const operationId = (result as { operationId: string }).operationId;
      expect((await manager.ops.receive.get(operationId))?.state).toBe(
        "executing",
      );
      // QUIRK: the pending entry's id ("receive-<op>") is not Coco's history
      // id ("receive:<op>"), its amount is a number, and it carries the bearer
      // token in metadata.rawToken. Coco has no history row for it yet.
      expect(JSON.parse(result.historyEntry)).toEqual({
        id: `receive-${operationId}`,
        type: "receive",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        mintUrl: MINT_URL,
        unit: "sat",
        amount: 8,
        state: "executing",
        operationId,
        metadata: { rawToken: token, operationId, pendingReason: "network" },
      });
      expect(await historyRows(manager)).toEqual([]);
      expect(await balance(manager)).toEqual({ spendable: 0, reserved: 0 });
      expect(mint.calls).toEqual(["swap", "checkstate"]);
    },
  );

  it("throws the offline-verification error instead of going pending when the token cannot be trusted offline", async () => {
    const { manager, mint } = await harness([]);
    mint.faults.swap = "down";
    const unverified = new Error("no DLEQ");

    await expect(
      appReceive(manager, async () => {
        throw unverified;
      })({
        tokenString: incomingToken(),
        mintUrl: MINT_URL,
        amount: 8,
      } as never),
    ).rejects.toBe(unverified);
  });
});

describe("mint: the app's createExecuteMintQuote against a real Coco Manager", () => {
  it("returns Coco's mint row, serialized with a numeric amount and the invoice", async () => {
    const { manager, mint } = await harness([]);

    const result = await appMintQuote(manager)({
      mintUrl: MINT_URL,
      amount: 21,
      unit: "sat",
    } as never);

    const operationId = await onlyOperationId(manager);
    expect(JSON.parse(result.historyEntry)).toMatchObject({
      id: `mint:${operationId}`,
      type: "mint",
      operationId,
      quoteId: "mint-quote-1",
      paymentRequest: "lnbc-synthetic-mint-invoice",
      amount: 21,
      // Coco's row says "pending"; the serialized contract says UNPAID.
      state: "UNPAID",
    });
    expect(await historyRows(manager)).toEqual([["mint", "pending"]]);
    expect(mint.calls).toEqual(["mintQuote"]);
  });

  it.each([
    ["refuse", "MintOperationError"],
    ["down", "NetworkError"],
  ] as const)(
    "rejects when the quote request fails (%s) and saves nothing",
    async (fault, name) => {
      const { manager, mint } = await harness([]);
      mint.faults.mintQuote = fault;

      await expect(
        appMintQuote(manager)({
          mintUrl: MINT_URL,
          amount: 21,
          unit: "sat",
        } as never),
      ).rejects.toMatchObject({ name });

      expect(await historyRows(manager)).toEqual([]);
    },
  );
});

describe("melt: quoteMelt then executeMelt against a real Coco Manager", () => {
  it("quotes amount and fee, then pays that quote once and returns PAID", async () => {
    const { manager, mint, ops } = await harness();

    const quote = await ops.quoteMelt!(MELT_INPUT as never);
    expect(quote).toMatchObject({
      quoteId: "melt-quote-1",
      quoteAmount: 10,
      feeReserve: 2,
      method: "bolt11",
      flowAmount: 10,
    });

    const result = await ops.executeMelt!({
      ...MELT_INPUT,
      quoteId: quote.quoteId,
    } as never);

    const operationId = await onlyOperationId(manager);
    expect(JSON.parse(result.historyEntry)).toEqual({
      // The melt entry is keyed by the bare operation id, not "melt:<op>".
      id: operationId,
      type: "melt",
      createdAt: expect.any(Number),
      mintUrl: MINT_URL,
      unit: "sat",
      quoteId: "melt-quote-1",
      state: "PAID",
      amount: 10,
      metadata: { operationId, meltTarget: INVOICE },
    });
    // The approved quote is reused: one quote request, one melt.
    expect(mint.calls).toEqual(["meltQuote", "swap", "melt"]);
    expect(await balance(manager)).toEqual({ spendable: 88, reserved: 0 });
  });

  it.each([
    ["refuse", "MintOperationError"],
    ["down", "NetworkError"],
  ] as const)(
    "quoteMelt rejects when the quote fails (%s)",
    async (fault, name) => {
      const { mint, ops } = await harness();
      mint.faults.meltQuote = fault;

      await expect(ops.quoteMelt!(MELT_INPUT as never)).rejects.toMatchObject({
        name,
      });
      expect(mint.calls).toEqual(["meltQuote"]);
    },
  );

  it("rejects on a melt refusal, rolls back and leaves the full balance spendable", async () => {
    const { manager, mint, ops } = await harness();
    const quote = await ops.quoteMelt!(MELT_INPUT as never);
    mint.faults.melt = "refuse";

    await expect(
      ops.executeMelt!({ ...MELT_INPUT, quoteId: quote.quoteId } as never),
    ).rejects.toMatchObject({ name: "MintOperationError", code: 11001 });

    expect(await historyRows(manager)).toEqual([["melt", "rolled_back"]]);
    expect(await balance(manager)).toEqual({ spendable: 100, reserved: 0 });
    expect(mint.calls.filter((call) => call === "melt")).toHaveLength(1);
  });

  it("rejects when the mint goes unreachable mid-melt and leaves the inputs in flight", async () => {
    const { manager, repos, mint, ops } = await harness();
    const quote = await ops.quoteMelt!(MELT_INPUT as never);
    mint.faults.melt = "down";

    await expect(
      ops.executeMelt!({ ...MELT_INPUT, quoteId: quote.quoteId } as never),
    ).rejects.toMatchObject({
      name: "MeltOutcomeUnknownError",
      operationId: expect.any(String),
      cause: { name: "NetworkError" },
    });

    expect(await historyRows(manager)).toEqual([["melt", "executing"]]);
    expect(await balance(manager)).toEqual({ spendable: 88, reserved: 0 });
    expect(await inflightSats(repos)).toBe(12);
    expect(mint.calls.filter((call) => call === "melt")).toHaveLength(1);
  });

  it("returns paid evidence when Coco recovered the paid melt after a lost reply", async () => {
    const { manager, mint, ops } = await harness();
    const quote = await ops.quoteMelt!(MELT_INPUT as never);
    mint.faults.melt = "lost";

    // Coco rethrows the transport error even after recovering to finalized.
    // The default operation returns that finalized record as paid evidence.
    const result = await ops.executeMelt!({ ...MELT_INPUT, quoteId: quote.quoteId });
    expect(JSON.parse(result.historyEntry)).toMatchObject({
      id: await onlyOperationId(manager),
      state: "PAID",
      quoteId: quote.quoteId,
    });

    expect(await historyRows(manager)).toEqual([["melt", "finalized"]]);
    expect(await balance(manager)).toEqual({ spendable: 88, reserved: 0 });
    expect(mint.calls.filter((call) => call === "melt")).toHaveLength(1);
  });
});
