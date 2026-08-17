/**
 * NUT-09 ownership boundary:
 *
 * Sovran invokes `manager.wallet.restore(mintUrl)`. Coco selects keysets,
 * persists the high-water counter, checks spent state, and saves only ready
 * proofs. The actual interval/gap walk belongs to cashu-ts `Wallet.batchRestore`.
 * These tests exercise both installed public contracts without implementing a
 * second restore walker in Colada.
 *
 * cashu-ts 5 walk semantics (changed from 4.x, which stepped one batch at a
 * time and stopped on the exact gap):
 *
 *  - The gap threshold is `ceil(gapLimit / batchSize)`, measured in *batches*.
 *  - Batches are issued in **waves of 4, concurrently**, and the consecutive-
 *    empty run is only evaluated at a wave boundary. Total requests are
 *    therefore always a multiple of 4, and the walk overscans past the gap
 *    rather than stopping on it. The docs call gapLimit "a floor, not an exact
 *    ceiling: batches already in flight past it are still processed."
 *  - `filterSpent` defaults to **true** and triggers a NUT-07 round trip.
 *    Coco passes `false` and keeps spent-checking ownership, so these tests
 *    pin that shape.
 *
 * The safety-critical invariant is that the walk never stops *before* covering
 * the gap. Overscanning costs requests; underscanning loses funds.
 */
import { Amount, CheckStateEnum, Wallet, type Proof } from "@cashu/cashu-ts";
import {
  initializeCoco,
  MemoryRepositories,
  type Manager,
} from "@cashu/coco-core";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

const MINT_URL = "https://restore-gap.test";
const MINT_PUBLIC_KEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
// Version byte 01 is the NUT-13 HMAC-SHA256 keyset family.
const V2_KEYSET_ID =
  "012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30";
const KEYPAIRS = Object.fromEntries(
  [1, 2, 4, 8, 16, 32, 64, 128].map((amount) => [
    String(amount),
    MINT_PUBLIC_KEY,
  ]),
);

function restoredProof(counter: number, amount = 1): Proof {
  return {
    id: V2_KEYSET_ID,
    amount: Amount.from(amount),
    secret: `restored-${counter}`,
    C: MINT_PUBLIC_KEY,
  };
}

function fakeWallet(
  implementation: (
    start: number,
    count: number,
    config?: { keysetId?: string },
  ) => Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }>,
): { wallet: Wallet; restore: ReturnType<typeof vi.fn> } {
  const restore = vi.fn(implementation);
  return { wallet: { restore } as unknown as Wallet, restore };
}

async function createManager(): Promise<{
  manager: Manager;
  repos: MemoryRepositories;
}> {
  const repos = new MemoryRepositories();
  const now = Math.floor(Date.now() / 1000);
  const mintInfo = {
    name: "Restore Gap Contract Mint",
    pubkey: MINT_PUBLIC_KEY,
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
    id: V2_KEYSET_ID,
    unit: "sat",
    keypairs: KEYPAIRS,
    active: true,
    feePpk: 0,
  });

  const manager = await initializeCoco({
    repo: repos,
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
  });

  return { manager, repos };
}

describe("installed cashu-ts restore interval contract", () => {
  it("covers at least the gap limit, scanning in whole waves of 4", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 0, max: 1_000 }),
        async (emptyBatches, batchSize, startCounter) => {
          const { wallet, restore } = fakeWallet(async () => ({ proofs: [] }));
          const result = await Wallet.prototype.batchRestore.call(wallet, {
            gapLimit: emptyBatches * batchSize,
            batchSize,
            counter: startCounter,
            keysetId: V2_KEYSET_ID,
            // Coco passes filterSpent: false and keeps NUT-07 ownership.
            filterSpent: false,
          });

          expect(result).toEqual({
            proofs: [],
            lastCounterWithSignature: undefined,
          });

          // gapLimit is emptyBatches * batchSize, so the threshold is exactly
          // `emptyBatches` batches; the walk rounds that up to whole waves.
          const expectedCalls = 4 * Math.ceil(emptyBatches / 4);
          expect(restore).toHaveBeenCalledTimes(expectedCalls);

          // The invariant that actually protects funds: never stop short of
          // the gap. Overscanning is permitted, underscanning is not.
          expect(restore.mock.calls.length).toBeGreaterThanOrEqual(emptyBatches);

          expect(restore.mock.calls.map(([counter]) => counter)).toEqual(
            Array.from(
              { length: expectedCalls },
              (_, index) => startCounter + index * batchSize,
            ),
          );
          expect(
            restore.mock.calls.every(
              ([, count, config]) =>
                count === batchSize && config?.keysetId === V2_KEYSET_ID,
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("walks contiguous signed batches, then requires the full empty gap before stopping", async () => {
    const { wallet, restore } = fakeWallet(async (start, count) => {
      if (start >= 200) return { proofs: [] };
      return {
        proofs: Array.from({ length: count }, (_, offset) =>
          restoredProof(start + offset),
        ),
        lastCounterWithSignature: start + count - 1,
      };
    });

    const result = await Wallet.prototype.batchRestore.call(wallet, {
      gapLimit: 300,
      batchSize: 100,
      counter: 0,
      keysetId: V2_KEYSET_ID,
      filterSpent: false,
    });

    // Wave 1 (0,100,200,300): 0 and 100 sign, so the empty run only reaches 2
    // of the required 3 and the walk continues. Wave 2 (400..700) is fully
    // empty, pushing the run to 6 and ending the scan at the wave boundary.
    expect(restore.mock.calls.map(([counter]) => counter)).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700,
    ]);
    expect(result.proofs).toHaveLength(200);
    expect(result.proofs[0]?.secret).toBe("restored-0");
    expect(result.proofs.at(-1)?.secret).toBe("restored-199");
    expect(result.lastCounterWithSignature).toBe(199);
  });

  it("continues across a multi-batch gap and resets the empty-run after later signatures", async () => {
    const { wallet, restore } = fakeWallet(async (start) => {
      if (start === 0) {
        return {
          proofs: [restoredProof(0), restoredProof(1), restoredProof(2)],
          lastCounterWithSignature: 2,
        };
      }
      if (start === 300) {
        return {
          proofs: [restoredProof(300), restoredProof(301)],
          lastCounterWithSignature: 301,
        };
      }
      return { proofs: [] };
    });

    const result = await Wallet.prototype.batchRestore.call(wallet, {
      gapLimit: 300,
      batchSize: 100,
      counter: 0,
      keysetId: V2_KEYSET_ID,
      filterSpent: false,
    });

    // The signature at counter 300 lands in wave 1 and resets the empty run to
    // 0, so wave 2 (400..700) has to rebuild the full gap from scratch.
    expect(restore.mock.calls.map(([counter]) => counter)).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700,
    ]);
    expect(result.proofs.map(({ secret }) => secret)).toEqual([
      "restored-0",
      "restored-1",
      "restored-2",
      "restored-300",
      "restored-301",
    ]);
    expect(result.lastCounterWithSignature).toBe(301);
  });

  it("filters spent proofs by default, which is why coco opts out", async () => {
    // cashu-ts 5 added filterSpent, defaulting to true. Coco owns spent-checking
    // (it saves only ready proofs), so it passes false to avoid a second NUT-07
    // round trip over every restored proof. Pin both halves of that contract.
    function walletWithSpentCheck() {
      const { wallet, restore } = fakeWallet(async (start) =>
        start === 0
          ? {
              proofs: [restoredProof(0), restoredProof(1)],
              lastCounterWithSignature: 1,
            }
          : { proofs: [] },
      );
      const checkProofsStates = vi.fn(async (proofs: Proof[]) =>
        proofs.map((_, index) => ({
          state: index === 0 ? CheckStateEnum.SPENT : CheckStateEnum.UNSPENT,
        })),
      );
      (wallet as unknown as Record<string, unknown>).checkProofsStates =
        checkProofsStates;
      return { wallet, restore, checkProofsStates };
    }

    const optedOut = walletWithSpentCheck();
    const kept = await Wallet.prototype.batchRestore.call(optedOut.wallet, {
      gapLimit: 300,
      batchSize: 100,
      counter: 0,
      keysetId: V2_KEYSET_ID,
      filterSpent: false,
    });
    expect(optedOut.checkProofsStates).not.toHaveBeenCalled();
    expect(kept.proofs.map(({ secret }) => secret)).toEqual([
      "restored-0",
      "restored-1",
    ]);

    const defaulted = walletWithSpentCheck();
    const filtered = await Wallet.prototype.batchRestore.call(
      defaulted.wallet,
      {
        gapLimit: 300,
        batchSize: 100,
        counter: 0,
        keysetId: V2_KEYSET_ID,
      },
    );
    expect(defaulted.checkProofsStates).toHaveBeenCalledOnce();
    expect(filtered.proofs.map(({ secret }) => secret)).toEqual(["restored-1"]);
  });
});

describe("Sovran -> coco restore persistence boundary", () => {
  it("delegates the v2 keyset gap walk, advances its high-water mark, and excludes spent proofs", async () => {
    const batchRestore = vi
      .spyOn(Wallet.prototype, "batchRestore")
      .mockResolvedValue({
        proofs: [restoredProof(4, 13), restoredProof(305, 21)],
        lastCounterWithSignature: 305,
      });
    const checkProofsStates = vi
      .spyOn(Wallet.prototype, "checkProofsStates")
      .mockResolvedValue([{ state: "SPENT" }, { state: "UNSPENT" }] as never);
    const { manager, repos } = await createManager();

    try {
      await manager.wallet.restore(MINT_URL);

      const counter = await repos.counterRepository.getCounter(
        MINT_URL,
        V2_KEYSET_ID,
      );
      const balances = await manager.wallet.balances.byMint();
      const readyProofs = await repos.proofRepository.getReadyProofs(MINT_URL, {
        unit: "sat",
      });

      expect(batchRestore).toHaveBeenCalledExactlyOnceWith({
        gapLimit: 300,
        batchSize: 100,
        counter: 0,
        keysetId: V2_KEYSET_ID,
        filterSpent: false,
      });
      expect(checkProofsStates).toHaveBeenCalledExactlyOnceWith([
        restoredProof(4, 13),
        restoredProof(305, 21),
      ]);
      expect(counter?.counter).toBe(306);
      expect(readyProofs).toEqual([
        expect.objectContaining({
          id: V2_KEYSET_ID,
          secret: "restored-305",
          state: "ready",
          unit: "sat",
        }),
      ]);
      expect(balances[MINT_URL]?.total.toNumber()).toBe(21);
      expect(
        await repos.proofRepository.getProofBySecret(MINT_URL, "restored-4"),
      ).toBeNull();
    } finally {
      await manager.dispose();
      batchRestore.mockRestore();
      checkProofsStates.mockRestore();
    }
  });
});
