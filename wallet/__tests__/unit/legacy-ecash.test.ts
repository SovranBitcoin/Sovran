import { describe, expect, it } from "vitest";

import {
  legacyEcashVerdict,
  runLegacyEcashClaim,
  type LegacyClaimPorts,
} from "../../src/legacy-ecash/claim";
import { readLegacyEcash, type LegacyEcashRead } from "../../src/legacy-ecash/reader";
import type { LegacyEcashRecords } from "../../src/legacy-ecash/records";

const MINT = "https://mint.example.com";
const KEYSET = "009a1f293253e41e";
const PROOFS = [
  { id: KEYSET, amount: 64, secret: "secret-a", C: "02a" },
  { id: KEYSET, amount: 32, secret: "secret-b", C: "02b" },
];
const NOW_MS = 1_800_000_000_000;

/** The row as the redux-era reducers wrote it: JSON strings inside JSON. */
function row(profiles: unknown[]): Extract<LegacyEcashRead, { kind: "read" }> {
  const read = readLegacyEcash(
    JSON.stringify({
      cashu: JSON.stringify({ profiles, keysets: { [MINT]: [{ id: KEYSET, unit: "sat" }] } }),
      nostr: JSON.stringify({ profiles: [] }),
    })
  );
  if (read.kind !== "read") throw new Error("fixture row did not read");
  return read;
}
const profile = (proofs: unknown, transactions: unknown[] = []) => ({ proofs, transactions });
const invoice = { quote: "q1", transactionType: "receive", mintUrl: MINT, amount: 21, unit: "sat", paid: false };

/** A wallet and mint that do the least possible, with every call recorded. */
function world(
  overrides: { accountIndex?: number; accounts?: number[]; isLive?: () => boolean } = {}
) {
  const records: LegacyEcashRecords = { groups: {}, quotes: {} };
  const calls: string[] = [];
  const state = {
    records,
    calls,
    held: new Set<string>(),
    spent: new Set<string>(),
    quote: { state: "unpaid", expirySec: null } as Awaited<ReturnType<LegacyClaimPorts["mint"]["quoteState"]>>,
    received: [] as string[][],
  };
  const prepared = new Map<string, string[]>();
  const ports: LegacyClaimPorts = {
    nowMs: NOW_MS,
    accountIndex: overrides.accountIndex ?? 0,
    accounts: overrides.accounts ?? [0, 1],
    targetAccount: (group) => group.profileIndex,
    isLive: overrides.isLive ?? (() => true),
    records: {
      read: () => records,
      writeGroup: async (id, record) => {
        calls.push("writeGroup");
        records.groups[id] = record;
      },
      writeQuote: async (id, record) => {
        calls.push("writeQuote");
        records.quotes[id] = record;
      },
    },
    mint: {
      checkStates: async (_mintUrl, proofs) => {
        calls.push("checkStates");
        return proofs.map((proof) => (state.spent.has(proof.secret) ? "SPENT" : "UNSPENT"));
      },
      keysetUnits: async () => new Map([[KEYSET, "sat"]]),
      quoteState: async () => {
        calls.push("quoteState");
        return state.quote;
      },
    },
    wallet: {
      isTrusted: async () => true,
      heldSecrets: async (_mintUrl, secrets) => {
        calls.push("heldSecrets");
        return new Set(secrets.filter((secret) => state.held.has(secret)));
      },
      prepareReceive: async (_mintUrl, _unit, proofs) => {
        calls.push("prepareReceive");
        const id = `op-${prepared.size + 1}`;
        prepared.set(id, proofs.map((proof) => proof.secret));
        return id;
      },
      executeReceive: async (id) => {
        calls.push("executeReceive");
        state.received.push(prepared.get(id) ?? []);
      },
      receiveState: async () => "finalized",
      cancelReceive: async () => {},
    },
  };
  return { ...state, ports };
}

describe("legacy ecash: old invoices", () => {
  const read = row([profile({}, [invoice])]);
  const statusAfter = async (quote: ReturnType<typeof world>["quote"]) => {
    const w = world();
    w.quote = quote;
    Object.assign(w.ports.mint, { quoteState: async () => quote });
    await runLegacyEcashClaim(read, w.ports);
    return { status: Object.values(w.records.quotes)[0]?.status, spent: legacyEcashVerdict(read, w.records).rowIsSpent };
  };

  it("treats only a positive answer as nothing to claim", async () => {
    expect(await statusAfter({ state: "issued", expirySec: null })).toEqual({ status: "nothing-to-claim", spent: true });
    expect(await statusAfter({ state: "unknown-quote", expirySec: null })).toEqual({ status: "nothing-to-claim", spent: true });
    expect(await statusAfter({ state: "unpaid", expirySec: NOW_MS / 1000 - 1 })).toEqual({ status: "nothing-to-claim", spent: true });
  });

  it("keeps the row for a paid invoice and for an unpaid one that may still be payable", async () => {
    expect(await statusAfter({ state: "paid", expirySec: 1 })).toEqual({ status: "paid-unclaimed", spent: false });
    expect(await statusAfter({ state: "unpaid", expirySec: null })).toEqual({ status: "open", spent: false });
    expect(await statusAfter({ state: "unpaid", expirySec: NOW_MS / 1000 + 60 })).toEqual({ status: "open", spent: false });
  });

  it("leaves an invoice unresolved after five failed lookups, which keeps the row", async () => {
    const w = world();
    Object.assign(w.ports.mint, {
      quoteState: async () => {
        throw Object.assign(new Error("Payment state is unknown"), { code: 50000 });
      },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await runLegacyEcashClaim(read, { ...w.ports, nowMs: NOW_MS + attempt * 8 * 24 * 60 * 60 * 1000 });
    }
    expect(Object.values(w.records.quotes)).toMatchObject([{ status: "unresolved", attempts: 5 }]);
    expect(legacyEcashVerdict(read, w.records).rowIsSpent).toBe(false);
  });
});

describe("legacy ecash: which account receives", () => {
  const read = row([profile({}), profile({ [MINT]: PROOFS })]);
  const groupId = `1|${KEYSET}|${MINT}`;

  it("claims nothing into another account before account 0 was compared", async () => {
    const w = world({ accountIndex: 1 });
    await runLegacyEcashClaim(read, w.ports);
    expect(w.calls).toEqual([]);
  });

  it("does not wait for an account 0 the phone does not have", async () => {
    const w = world({ accountIndex: 1, accounts: [1] });
    await runLegacyEcashClaim(read, w.ports);
    expect(w.received).toEqual([["secret-a", "secret-b"]]);
    expect(w.records.groups[groupId]).toMatchObject({
      status: "settled",
      claimed: 96,
      firstAccountComparison: "no-first-account",
    });
  });

  it("drops a claim marker left by an account that was removed, and asks the mint again", async () => {
    const first = world({ accountIndex: 1, accounts: [1] });
    await runLegacyEcashClaim(read, first.ports);
    const w = world({ accountIndex: 2, accounts: [2] });
    Object.assign(w.ports, { targetAccount: () => 2 });
    w.records.groups[groupId] = {
      ...first.records.groups[groupId]!,
      status: "open",
      done: [],
      claimed: 0,
      claiming: { operationId: "op-gone", accountIndex: 1, proofs: [], amount: 96 },
    };
    w.spent.add("secret-a").add("secret-b");
    await runLegacyEcashClaim(read, w.ports);
    expect(w.received).toEqual([]);
    expect(w.records.groups[groupId]).toMatchObject({
      status: "settled",
      accountIndex: 2,
      spent: 96,
      claiming: null,
    });
  });

  it("finishes with what account 0 holds and claims only the rest into the profile's account", async () => {
    const first = world({ accountIndex: 0 });
    first.held.add("secret-a");
    await runLegacyEcashClaim(read, first.ports);
    expect(first.received).toEqual([]);
    expect(first.records.groups[groupId]).toMatchObject({
      status: "open",
      inWallet: 64,
      firstAccountComparison: "compared",
    });

    const second = world({ accountIndex: 1 });
    Object.assign(second.records, first.records);
    await runLegacyEcashClaim(read, second.ports);
    expect(second.received).toEqual([["secret-b"]]);
    expect(second.records.groups[groupId]).toMatchObject({ status: "settled", inWallet: 64, claimed: 32 });
  });
});

describe("legacy ecash: a wallet that closes mid-run", () => {
  const read = row([profile({ [MINT]: PROOFS }, [invoice])]);

  it("does nothing when it is closed from the start", async () => {
    const w = world({ isLive: () => false });
    await runLegacyEcashClaim(read, w.ports);
    expect(w.calls).toEqual([]);
  });

  it.each(["heldSecrets", "checkStates", "prepareReceive"])(
    "writes and receives nothing once it closes during %s",
    async (during) => {
      let live = true;
      const w = world({ isLive: () => live });
      const port = during === "checkStates" ? w.ports.mint : w.ports.wallet;
      const original = Reflect.get(port, during) as (...args: unknown[]) => Promise<unknown>;
      Object.assign(port, {
        [during]: async (...args: unknown[]) => {
          const result = await original(...args);
          live = false;
          return result;
        },
      });
      await runLegacyEcashClaim(read, w.ports);
      const after = w.calls.slice(w.calls.lastIndexOf(during) + 1);
      expect(after).toEqual([]);
      expect(w.received).toEqual([]);
    }
  );
});
