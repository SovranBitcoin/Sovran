import {
  Amount,
  createBlindSignature,
  deriveKeysetId,
  pointFromHex,
} from "@cashu/cashu-ts";
import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";
import { expect, it, vi } from "vitest";

it("claims identical BLE and Nostr payloads once through the installed Coco pipeline", async () => {
  const mint = "https://nearby-dedupe.test";
  const mintKey = new Uint8Array(32);
  mintKey[31] = 1;
  const publicKey =
    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const keypairs = Object.fromEntries(
    [1, 2, 4, 8, 16].map((amount) => [String(amount), publicKey]),
  );
  const keyset = deriveKeysetId(keypairs, { unit: "sat", input_fee_ppk: 0 });
  const repo = new MemoryRepositories();
  const now = Math.floor(Date.now() / 1000);
  await repo.mintRepository.addNewMint({
    mintUrl: mint,
    name: "Synthetic mint",
    trusted: true,
    createdAt: now,
    updatedAt: now,
    mintInfo: {
      name: "Synthetic mint",
      contact: [],
      pubkey: publicKey,
      version: "test",
      nuts: {
        "4": { methods: [], disabled: false },
        "5": { methods: [], disabled: false },
      },
    },
  });
  await repo.keysetRepository.addKeyset({
    mintUrl: mint,
    id: keyset,
    unit: "sat",
    keypairs,
    active: true,
    feePpk: 0,
  });
  const swap = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).endsWith("/v1/swap"))
        throw new Error(`Unexpected synthetic mint request: ${String(url)}`);
      const body = JSON.parse(String(init?.body)) as {
        outputs: { amount: number; B_: string }[];
      };
      return new Response(
        JSON.stringify({
          signatures: body.outputs.map((output) => ({
            id: keyset,
            amount: output.amount,
            C_: createBlindSignature(
              pointFromHex(output.B_),
              mintKey,
              keyset,
            ).C_.toHex(true),
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );
  vi.stubGlobal("fetch", swap);
  const manager = await initializeCoco({
    repo,
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
  try {
    const request = await manager.paymentRequests.incoming.create({
      amount: 1,
      unit: "sat",
      mints: [mint],
      singleUse: false,
    });
    const payload = JSON.stringify({
      id: request.requestId,
      mint,
      unit: "sat",
      proofs: [
        { id: keyset, amount: 8, secret: "synthetic-input", C: publicKey },
      ],
    });
    const results = await Promise.allSettled([
      manager.paymentRequests.incoming.ingestPayload(payload, {
        transport: "inband",
        transportMessageId: "ble-first",
      }),
      manager.paymentRequests.incoming.ingestPayload(payload, {
        transport: "nostr",
        transportMessageId: "nostr-first",
      }),
    ]);
    expect(
      results.some(
        (result) =>
          result.status === "fulfilled" &&
          result.value.attempt.state === "finalized",
      ),
    ).toBe(true);
    const replay = await manager.paymentRequests.incoming.ingestPayload(
      payload,
      { transport: "nostr", transportMessageId: "nostr-replay" },
    );
    const bleReplay = await manager.paymentRequests.incoming.ingestPayload(
      payload,
      { transport: "inband", transportMessageId: "ble-replay" },
    );
    expect(replay.attempt.state).toBe("finalized");
    expect(bleReplay.attempt.id).toBe(replay.attempt.id);
    expect(replay.attempt.netAmount).toEqual(Amount.from(8));
    expect(swap).toHaveBeenCalledTimes(1);
    const history = await manager.history.getPaginatedHistory(0, 10);
    expect(
      history
        .filter((entry) => entry.type === "receive")
        .map((entry) => entry.amount),
    ).toEqual([Amount.from(8)]);
  } finally {
    await manager.dispose();
    vi.unstubAllGlobals();
  }
});
