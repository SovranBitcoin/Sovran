/**
 * Offline ecash send against the installed coco-core bundle.
 *
 * An exact-match send needs nothing from the mint: the proofs already in the
 * wallet are the token. `executeOfflineSend` prepares with coco's `offline`
 * option (app/patches/@cashu+coco-core+2.0.0.patch), which builds the wallet
 * from stored keysets and never contacts the mint. The online path keeps
 * coco's behaviour: stale mint data is refreshed, and an unreachable mint
 * fails before anything is reserved.
 */
import { Amount, deriveKeysetId } from "@cashu/cashu-ts";
import {
  initializeCoco,
  MemoryRepositories,
  type CoreProof,
  type Manager,
} from "@cashu/coco-core";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isMintOfflineError } from "../../src/errors";
import { buildProofSuggestions } from "../../src/machine/amountFallback";
import { createDefaultOperations } from "../../src/operations/defaultOperations";

const MINT_URL = "https://mint.test";
const PUBKEYS = [
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
  "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
  "03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb",
] as const;
const DENOMINATIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const KEYPAIRS = Object.fromEntries(
  DENOMINATIONS.map((amount, index) => [
    String(amount),
    PUBKEYS[index % PUBKEYS.length]!,
  ]),
);
const KEYSET_ID = deriveKeysetId(KEYPAIRS, { unit: "sat", input_fee_ppk: 0 });

/** coco refreshes mint data older than this (MINT_REFRESH_TTL_S). */
const COCO_MINT_REFRESH_TTL_S = 5 * 60;
const STALE_SEC = () =>
  Math.floor(Date.now() / 1000) - COCO_MINT_REFRESH_TTL_S - 60;

function proof(secret: string, amount: number): CoreProof {
  return {
    id: KEYSET_ID,
    amount: Amount.from(amount),
    secret,
    C: PUBKEYS[0],
    mintUrl: MINT_URL,
    unit: "sat",
    state: "ready",
  };
}

async function createSeededManager(
  mintUpdatedAtSec: number,
  amounts: number[] = [64, 32, 4],
): Promise<Manager> {
  const repos = new MemoryRepositories();
  const mintInfo = {
    name: "Offline Contract Mint",
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
    createdAt: mintUpdatedAtSec,
    updatedAt: mintUpdatedAtSec,
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
  await repos.proofRepository.saveProofs(
    MINT_URL,
    amounts.map((amount, index) => proof(`p-${index}-${amount}`, amount)),
  );
  return manager;
}

function tokenSecrets(historyEntry: string): string[] {
  const entry = JSON.parse(historyEntry) as {
    token: { proofs: { secret: string }[] };
  };
  return entry.token.proofs.map((p) => p.secret).sort();
}

/** Reserved proofs, read the way app/shared/lib/cashu/managerInternals.ts does. */
async function reservedCount(manager: Manager): Promise<number> {
  const internals = manager as unknown as {
    proofRepository: { getReservedProofs(): Promise<CoreProof[]> };
  };
  return (await internals.proofRepository.getReservedProofs()).length;
}

describe("offline exact-match send with a dead network", () => {
  const fetchSpy = vi.fn(async () => {
    // React Native's spelling of a failed fetch in airplane mode.
    throw new TypeError("Network request failed");
  });

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a token from stale stored mint data without contacting the mint", async () => {
    const manager = await createSeededManager(STALE_SEC());
    try {
      const operations = createDefaultOperations({ getManager: () => manager });
      const result = await operations.executeOfflineSend!(MINT_URL, 36);

      expect(tokenSecrets(result.historyEntry)).toEqual(["p-1-32", "p-2-4"]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("refuses an amount with no exact match, reserving nothing and contacting no one", async () => {
    const manager = await createSeededManager(STALE_SEC());
    try {
      const operations = createDefaultOperations({ getManager: () => manager });
      // 35 is not a subset sum of 64 + 32 + 4.
      await expect(
        operations.executeOfflineSend!(MINT_URL, 35),
      ).rejects.toThrow(
        "Offline send needs proofs that add up to exactly 35 sat",
      );
      expect(await reservedCount(manager)).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("keeps the online path online: stale mint data is refreshed, and failure is a mint-offline error", async () => {
    const manager = await createSeededManager(STALE_SEC());
    try {
      const operations = createDefaultOperations({ getManager: () => manager });
      const failure = await operations.executeSend!(MINT_URL, 36).then(
        () => null,
        (error: unknown) => error,
      );

      expect(fetchSpy).toHaveBeenCalled();
      expect(isMintOfflineError(failure)).toBe(true);
      expect(await reservedCount(manager)).toBe(0);
    } finally {
      await manager.dispose();
    }
  });

  it("selects an exact binary composition even when randomized selection misses it", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const manager = await createSeededManager(STALE_SEC(), [512, 1, 32, 32, 8, 1, 4, 1, 256, 4, 8, 512]);
    try {
      const operations = createDefaultOperations({ getManager: () => manager });
      const result = await operations.executeOfflineSend!(MINT_URL, 1097);
      expect(tokenSecrets(result.historyEntry)).toEqual([
        "p-0-512", "p-1-1", "p-11-512", "p-2-32", "p-3-32", "p-4-8",
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      await manager.dispose();
    }
  });

  it("agrees with the amount screen about which amounts can be sent offline", async () => {
    // The screen promises an offline send when buildProofSuggestions finds an
    // exact composition; coco must then be able to make it.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...DENOMINATIONS), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 2048 }),
        async (amounts, target) => {
          const manager = await createSeededManager(STALE_SEC(), amounts);
          try {
            const operations = createDefaultOperations({
              getManager: () => manager,
            });
            const screenSaysExact = buildProofSuggestions(
              amounts,
              target,
            ).exactMatch;
            const cocoSent = await operations.executeOfflineSend!(
              MINT_URL,
              target,
            ).then(
              () => true,
              () => false,
            );
            expect(cocoSent).toBe(screenSaysExact);
          } finally {
            await manager.dispose();
          }
        },
      ),
      { numRuns: 150 },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
