/**
 * NUT-08 ownership boundary:
 *
 * Sovran orders coco's durable prepare before execute. Coco owns deterministic
 * blank-output creation, persistence, and deferred settlement recovery; cashu-ts
 * owns unblinding. These tests exercise those installed public contracts without
 * reproducing recovery or cryptographic code in Colada.
 */
import {
  Amount,
  createBlindSignature,
  deriveKeysetId,
  pointFromHex,
  type SerializedBlindedSignature,
} from "@cashu/cashu-ts";
import {
  initializeCoco,
  meltQuoteFromBolt11Response,
  MemoryRepositories,
  type BoltMeltQuote,
  type CoreProof,
  type Manager,
  type PreparedMeltOperation,
} from "@cashu/coco-core";
import { describe, expect, it, vi } from "vitest";

import { createDefaultOperations } from "../../src/operations/defaultOperations";

const MINT_URL = "https://melt-change.test";
const MINT_PRIVATE_KEY = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 1,
]);
const MINT_PUBLIC_KEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const KEYPAIRS = Object.fromEntries(
  [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048].map((amount) => [
    String(amount),
    MINT_PUBLIC_KEY,
  ]),
);
const KEYSET_ID = deriveKeysetId(KEYPAIRS, {
  unit: "sat",
  input_fee_ppk: 0,
});

interface MeltHarness {
  manager: Manager;
  repos: MemoryRepositories;
}

function inputProof(secret: string, amount: number): CoreProof {
  return {
    id: KEYSET_ID,
    amount: Amount.from(amount),
    secret,
    C: MINT_PUBLIC_KEY,
    mintUrl: MINT_URL,
    unit: "sat",
    state: "ready",
  };
}

function quote(
  quoteId: string,
  feeReserve: number,
  state: "UNPAID" | "PAID" = "UNPAID",
): BoltMeltQuote<"bolt11"> {
  return meltQuoteFromBolt11Response(MINT_URL, {
    quote: quoteId,
    request: "lnbc1meltchangecontract",
    amount: Amount.from(100),
    unit: "sat",
    fee_reserve: Amount.from(feeReserve),
    expiry: Math.floor(Date.now() / 1000) + 3_600,
    state,
    payment_preimage: state === "PAID" ? "preimage" : null,
    change: state === "PAID" ? [] : undefined,
  });
}

async function createHarness(): Promise<MeltHarness> {
  const repos = new MemoryRepositories();
  const now = Math.floor(Date.now() / 1000);
  const bolt11 = {
    method: "bolt11",
    unit: "sat",
    min_amount: null,
    max_amount: null,
  };
  const mintInfo = {
    name: "Melt Change Contract Mint",
    pubkey: MINT_PUBLIC_KEY,
    version: "test",
    contact: [],
    nuts: {
      "4": { methods: [bolt11], disabled: false },
      "5": { methods: [bolt11], disabled: false },
    },
  };

  await repos.mintRepository.addNewMint({
    mintUrl: MINT_URL,
    name: mintInfo.name,
    mintInfo,
    trusted: true,
    createdAt: now,
    updatedAt: now,
  });
  await repos.keysetRepository.addKeyset({
    mintUrl: MINT_URL,
    id: KEYSET_ID,
    unit: "sat",
    keypairs: KEYPAIRS,
    active: true,
    feePpk: 0,
  });

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

  return { manager, repos };
}

async function prepareMelt(
  harness: MeltHarness,
  quoteId: string,
  feeReserve: number,
): Promise<PreparedMeltOperation> {
  const canonicalQuote = quote(quoteId, feeReserve);
  await harness.repos.meltQuoteRepository.upsertMeltQuote(canonicalQuote);
  await harness.repos.proofRepository.saveProofs(MINT_URL, [
    inputProof(`input-${quoteId}`, 100 + feeReserve),
  ]);

  return harness.manager.ops.melt.prepare({ quote: canonicalQuote });
}

function signChangeOutput(
  prepared: PreparedMeltOperation,
  amount: number,
): SerializedBlindedSignature {
  const output = prepared.changeOutputData.keep[0];
  if (!output) throw new Error("Expected a persisted blank change output");

  const signature = createBlindSignature(
    pointFromHex(output.blindedMessage.B_),
    MINT_PRIVATE_KEY,
    KEYSET_ID,
  );
  return {
    id: KEYSET_ID,
    amount: Amount.from(amount),
    C_: signature.C_.toHex(true),
  };
}

describe("Sovran -> coco NUT-08 lifecycle boundary", () => {
  it("persists coco's prepared change outputs before invoking irreversible execute", async () => {
    const canonicalQuote = quote("boundary-order", 10);
    const prepared = {
      id: "melt-op",
      quoteId: canonicalQuote.quoteId,
      changeOutputData: { keep: [{ persisted: true }], send: [] },
    };
    const finalized = {
      ...prepared,
      state: "finalized",
      createdAt: 1,
      mintUrl: MINT_URL,
      amount: Amount.from(100),
    };
    const create = vi.fn().mockResolvedValue(canonicalQuote);
    const prepare = vi.fn().mockResolvedValue(prepared);
    const execute = vi.fn().mockResolvedValue(finalized);
    const manager = {
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute } },
    } as unknown as Manager;
    const operations = createDefaultOperations({ getManager: () => manager });

    await operations.executeMelt!(
      MINT_URL,
      "lnbc1meltchangecontract",
      100,
      "sat",
    );

    expect(prepare).toHaveBeenCalledExactlyOnceWith({ quote: canonicalQuote });
    expect(execute).toHaveBeenCalledExactlyOnceWith(prepared.id);
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[0]!,
    );
  });
});

describe("installed coco NUT-08 persistence and recovery contract", () => {
  it.each([
    { feeReserve: 0, expectedBlanks: 0 },
    { feeReserve: 8, expectedBlanks: 3 },
    { feeReserve: 9, expectedBlanks: 4 },
    { feeReserve: 1_000, expectedBlanks: 10 },
  ])(
    "persists $expectedBlanks blank outputs for a $feeReserve sat reserve",
    async ({ feeReserve, expectedBlanks }) => {
      const harness = await createHarness();

      try {
        const prepared = await prepareMelt(
          harness,
          `blank-count-${feeReserve}`,
          feeReserve,
        );
        const persisted = await harness.manager.ops.melt.get(prepared.id);
        const counter = await harness.repos.counterRepository.getCounter(
          MINT_URL,
          KEYSET_ID,
        );

        expect(prepared.state).toBe("prepared");
        expect(prepared.changeOutputData.keep).toHaveLength(expectedBlanks);
        expect(prepared.changeOutputData.send).toEqual([]);
        expect(persisted).toMatchObject({
          id: prepared.id,
          state: "prepared",
          changeOutputData: prepared.changeOutputData,
        });
        expect(() => JSON.stringify(prepared.changeOutputData)).not.toThrow();
        expect(counter?.counter ?? 0).toBe(expectedBlanks);

        await harness.manager.ops.melt.cancel(prepared.id);
      } finally {
        await harness.manager.dispose();
      }
    },
  );

  it("uses persisted modern output data for a deferred short no-DLEQ change set", async () => {
    const harness = await createHarness();

    try {
      const prepared = await prepareMelt(harness, "deferred-paid", 8);
      const change = signChangeOutput(prepared, 8);
      expect(change.dleq).toBeUndefined();
      expect(prepared.changeOutputData.keep).toHaveLength(3);
      await harness.repos.meltOperationRepository.update({
        ...prepared,
        state: "pending",
        updatedAt: Date.now(),
      });
      await harness.repos.meltQuoteRepository.upsertMeltQuote({
        ...quote("deferred-paid", 8, "PAID"),
        change: [change],
      });

      const recovered = await harness.manager.ops.melt.refresh(prepared.id);
      const stored = await harness.repos.meltOperationRepository.getById(
        prepared.id,
      );
      const recoveredProofs =
        await harness.repos.proofRepository.getReadyProofs(MINT_URL, {
          unit: "sat",
        });
      const spentInput = await harness.repos.proofRepository.getProofBySecret(
        MINT_URL,
        "input-deferred-paid",
      );

      expect(recovered).toMatchObject({
        id: prepared.id,
        state: "finalized",
        changeOutputData: prepared.changeOutputData,
        changeAmount: Amount.from(8),
        effectiveFee: Amount.zero(),
      });
      expect(stored).toMatchObject({
        state: "finalized",
        changeOutputData: prepared.changeOutputData,
      });
      expect(spentInput?.state).toBe("spent");
      expect(recoveredProofs).toEqual([
        expect.objectContaining({
          amount: Amount.from(8),
          createdByOperationId: prepared.id,
          state: "ready",
        }),
      ]);
    } finally {
      await harness.manager.dispose();
    }
  });
});
