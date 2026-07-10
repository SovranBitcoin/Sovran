/**
 * Fee-aware proof selection is deliberately not implemented in Colada:
 * Sovran passes a raw send amount or canonical melt quote into coco v2, whose
 * shared ProofService filters availability and delegates fee-aware selection
 * to cashu-ts. These tests pin both halves of that installed dependency chain
 * without copying the selector into Sovran test code.
 */
import { Amount, deriveKeysetId } from "@cashu/cashu-ts";
import {
  initializeCoco,
  MemoryRepositories,
  type CoreProof,
  type Manager,
} from "@cashu/coco-core";
import { describe, expect, it, vi } from "vitest";

import { createDefaultOperations } from "../../src/operations/defaultOperations";

const MINT_URL = "https://mint.test";
const PUBKEYS = [
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
  "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
  "03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb",
] as const;

function keypairs(offset: number): Record<string, string> {
  return Object.fromEntries(
    [1, 2, 4, 8, 16, 32, 64, 128, 256].map((amount, index) => [
      String(amount),
      PUBKEYS[(index + offset) % PUBKEYS.length]!,
    ]),
  );
}

const KEYPAIRS_A = keypairs(0);
const KEYPAIRS_B = keypairs(1);
const KEYSET_A_FEE_PPK = 1000;
const KEYSET_B_FEE_PPK = 2000;
const KEYSET_A = deriveKeysetId(KEYPAIRS_A, {
  unit: "sat",
  input_fee_ppk: KEYSET_A_FEE_PPK,
});
const KEYSET_B = deriveKeysetId(KEYPAIRS_B, {
  unit: "sat",
  input_fee_ppk: KEYSET_B_FEE_PPK,
});
const FEE_PPK = new Map([
  [KEYSET_A, KEYSET_A_FEE_PPK],
  [KEYSET_B, KEYSET_B_FEE_PPK],
]);

function proof(
  secret: string,
  amount: number,
  id: string,
  overrides: Partial<CoreProof> = {},
): CoreProof {
  return {
    id,
    amount: Amount.from(amount),
    secret,
    C: PUBKEYS[0],
    mintUrl: MINT_URL,
    unit: "sat",
    state: "ready",
    ...overrides,
  };
}

async function createSeededManager(proofs: CoreProof[]): Promise<Manager> {
  const repos = new MemoryRepositories();
  const now = Math.floor(Date.now() / 1000);
  const mintInfo = {
    name: "Fee Contract Mint",
    pubkey: PUBKEYS[0],
    version: "test",
    contact: [],
    nuts: {
      "4": { methods: [], disabled: false },
      "5": { methods: [], disabled: false },
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
    id: KEYSET_A,
    unit: "sat",
    keypairs: KEYPAIRS_A,
    active: true,
    feePpk: FEE_PPK.get(KEYSET_A)!,
  });
  await repos.keysetRepository.addKeyset({
    mintUrl: MINT_URL,
    id: KEYSET_B,
    unit: "sat",
    keypairs: KEYPAIRS_B,
    active: true,
    feePpk: FEE_PPK.get(KEYSET_B)!,
  });
  const manager = await initializeCoco({
    repo: repos,
    seedGetter: async () => new Uint8Array(64).fill(1),
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
  // Seed after startup recovery: an intentionally orphaned reservation would
  // otherwise be correctly released by coco before this selection fixture runs.
  await repos.proofRepository.saveProofs(MINT_URL, proofs);
  return manager;
}

describe("Sovran -> coco fee-selection boundary", () => {
  it("passes the raw send amount to coco instead of precomputing a one-shot fee target", async () => {
    const stopAfterPrepare = new Error("stop after boundary capture");
    const prepare = vi.fn().mockRejectedValue(stopAfterPrepare);
    const manager = { ops: { send: { prepare } } } as unknown as Manager;
    const operations = createDefaultOperations({ getManager: () => manager });

    await expect(operations.executeSend!(MINT_URL, 103)).rejects.toBe(
      stopAfterPrepare,
    );

    expect(prepare).toHaveBeenCalledExactlyOnceWith({
      mintUrl: MINT_URL,
      amount: 103,
    });
  });

  it("passes the canonical melt quote unchanged so coco owns fee-reserve convergence", async () => {
    const quote = {
      mintUrl: MINT_URL,
      method: "bolt11",
      quoteId: "quote-1",
      amount: Amount.from(100),
      fee_reserve: Amount.from(3),
      unit: "sat",
    };
    const stopAfterPrepare = new Error("stop after boundary capture");
    const create = vi.fn().mockResolvedValue(quote);
    const prepare = vi.fn().mockRejectedValue(stopAfterPrepare);
    const manager = {
      quotes: { melt: { create } },
      ops: { melt: { prepare } },
    } as unknown as Manager;
    const operations = createDefaultOperations({ getManager: () => manager });

    await expect(
      operations.executeMelt!(MINT_URL, "lnbc1feecontract", 100, "sat"),
    ).rejects.toBe(stopAfterPrepare);

    expect(create).toHaveBeenCalledExactlyOnceWith({
      mintUrl: MINT_URL,
      method: "bolt11",
      methodData: { invoice: "lnbc1feecontract" },
      unit: "sat",
    });
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ quote });
  });
});

describe("coco v2 + cashu-ts fee-aware selection contract", () => {
  it("covers target + fee(selected) across mixed keysets and skips unavailable proofs", async () => {
    const manager = await createSeededManager([
      proof("a-64", 64, KEYSET_A),
      proof("b-32", 32, KEYSET_B),
      proof("a-16", 16, KEYSET_A),
      proof("b-8", 8, KEYSET_B),
      proof("a-4", 4, KEYSET_A),
      proof("b-2", 2, KEYSET_B),
      proof("reserved-128", 128, KEYSET_A, {
        usedByOperationId: "other-operation",
      }),
      proof("pending-256", 256, KEYSET_B, { state: "inflight" }),
    ]);

    try {
      // 103 cannot be composed exactly from the available even denominations,
      // so coco must ask cashu-ts for a fee-aware swap selection.
      const prepared = await manager.ops.send.prepare({
        mintUrl: MINT_URL,
        amount: 103,
      });
      const selected = prepared.inputProofSecrets;
      const selectedIds = new Set(
        [
          proof("a-64", 64, KEYSET_A),
          proof("b-32", 32, KEYSET_B),
          proof("a-16", 16, KEYSET_A),
          proof("b-8", 8, KEYSET_B),
          proof("a-4", 4, KEYSET_A),
          proof("b-2", 2, KEYSET_B),
        ]
          .filter((candidate) => selected.includes(candidate.secret))
          .map((candidate) => candidate.id),
      );
      const expectedFee = Math.ceil(
        [...selectedIds].reduce(
          (total, id) =>
            total +
            selected.filter((secret) =>
              secret.startsWith(id === KEYSET_A ? "a-" : "b-"),
            ).length *
              FEE_PPK.get(id)!,
          0,
        ) / 1000,
      );

      expect(prepared.needsSwap).toBe(true);
      expect(selectedIds).toEqual(new Set([KEYSET_A, KEYSET_B]));
      expect(selected).not.toContain("reserved-128");
      expect(selected).not.toContain("pending-256");
      expect(prepared.fee.toNumber()).toBe(expectedFee);
      expect(
        prepared.inputAmount.toNumber() - prepared.fee.toNumber(),
      ).toBeGreaterThanOrEqual(103);

      await manager.ops.send.cancel(prepared.id);
    } finally {
      await manager.dispose();
    }
  });

  it("terminates with insufficient funds when available value cannot cover its own input fee", async () => {
    const manager = await createSeededManager([
      proof("b-64", 64, KEYSET_B),
      proof("b-32", 32, KEYSET_B),
      proof("b-8", 8, KEYSET_B),
    ]);

    try {
      await expect(
        manager.ops.send.prepare({ mintUrl: MINT_URL, amount: 100 }),
      ).rejects.toThrow(/not sufficient|not enough/i);
    } finally {
      await manager.dispose();
    }
  }, 2000);
});
