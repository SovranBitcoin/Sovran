import { describe, expect, it, vi } from "vitest";
import { getEncodedToken, Amount, type Proof } from "@cashu/cashu-ts";
import {
  classifyMeshToken,
  meshTokenDedupeKey,
} from "../../src/transport/classify";
import {
  classifyMeshRedeemError,
  createMeshRedeemOrchestrator,
} from "../../src/transport/redeemOrchestrator";
import type { MeshRedeemEntry } from "../../src/transport/redeemEntry";

const MY_PUBKEY = `02${"ab".repeat(32)}`;
const OTHER_PUBKEY = `02${"cd".repeat(32)}`;
const MINT_URL = "https://mint.test";
const KEYSET_ID = "009a1f293253e41e";

function p2pkSecret(
  pubkey: string,
  tags?: string[][],
  nonce = "11".repeat(16),
): string {
  return JSON.stringify([
    "P2PK",
    { nonce, data: pubkey, ...(tags ? { tags } : {}) },
  ]);
}

function proof(secret: string, amount = 2): Proof {
  // `Proof.amount` is a cashu-ts `Amount`, not a number. The encoder normalises
  // either form to the same bytes, so this is about the fixture describing the
  // shape production actually carries.
  return {
    amount: Amount.from(amount),
    id: KEYSET_ID,
    secret,
    C: `02${"ef".repeat(32)}`,
  };
}

function encode(proofs: ReturnType<typeof proof>[]): string {
  return getEncodedToken({ mint: MINT_URL, proofs, unit: "sat" });
}

// ---------------------------------------------------------------------------
// classify (port of sovran-app nutDropTokens suite)
// ---------------------------------------------------------------------------

describe("classifyMeshToken", () => {
  it("classifies a token fully locked to my key", () => {
    const token = encode([
      proof(p2pkSecret(MY_PUBKEY), 2),
      proof(p2pkSecret(MY_PUBKEY, undefined, "22".repeat(16)), 4),
    ]);
    expect(classifyMeshToken(token, MY_PUBKEY)).toEqual({
      classification: "locked-to-me",
      mintUrl: MINT_URL,
      amount: 6,
      unit: "sat",
    });
  });

  it("is invalid when the proofs add up to more than a number can hold exactly", () => {
    const big = 2 ** 52;
    const token = encode([
      proof("aa".repeat(32), big),
      proof("bb".repeat(32), big),
      proof("cc".repeat(32), 1),
    ]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe("invalid");
  });

  it("matches the lock key case-insensitively", () => {
    const token = encode([proof(p2pkSecret(MY_PUBKEY))]);
    expect(
      classifyMeshToken(token, MY_PUBKEY.toUpperCase()).classification,
    ).toBe("locked-to-me");
  });

  // NUT-11 keys are compressed points: `02<x>` and `03<x>` are the SAME key.
  // A sender using a true SEC1-compressed key can lock to the 03 parity, and
  // whole-string equality would drop a drop that is genuinely ours.
  it("matches a lock that uses the 03 parity for the same x coordinate", () => {
    const token = encode([proof(p2pkSecret(`03${MY_PUBKEY.slice(2)}`))]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe(
      "locked-to-me",
    );
  });

  it("still rejects a 03 lock whose x coordinate is someone else", () => {
    const token = encode([proof(p2pkSecret(`03${"cd".repeat(32)}`))]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe(
      "locked-to-other",
    );
  });

  it("never classifies the sender's own broadcast echo as locked-to-me", () => {
    const senderEcho = encode([proof(p2pkSecret(OTHER_PUBKEY), 21)]);
    expect(classifyMeshToken(senderEcho, MY_PUBKEY).classification).toBe(
      "locked-to-other",
    );
  });

  it("treats mixed locked + bearer proofs as locked-to-other", () => {
    const token = encode([
      proof(p2pkSecret(MY_PUBKEY)),
      proof("aa".repeat(32)),
    ]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe(
      "locked-to-other",
    );
  });

  it("treats multisig locks as locked-to-other even when my key is included", () => {
    const token = encode([
      proof(
        p2pkSecret(MY_PUBKEY, [
          ["pubkeys", OTHER_PUBKEY],
          ["n_sigs", "2"],
        ]),
      ),
    ]);
    expect(classifyMeshToken(token, MY_PUBKEY).classification).toBe(
      "locked-to-other",
    );
  });

  it("never classifies non-P2PK spending conditions as bearer (HTLC etc.)", () => {
    const htlcSecret = JSON.stringify([
      "HTLC",
      { nonce: "11".repeat(16), data: "ab".repeat(32) },
    ]);
    expect(
      classifyMeshToken(encode([proof(htlcSecret)]), MY_PUBKEY).classification,
    ).toBe("locked-to-other");
    expect(
      classifyMeshToken(
        encode([proof("aa".repeat(32)), proof(htlcSecret)]),
        MY_PUBKEY,
      ).classification,
    ).toBe("locked-to-other");
  });

  it("classifies plain-secret tokens as bearer and junk as invalid", () => {
    expect(
      classifyMeshToken(encode([proof("aa".repeat(32))]), MY_PUBKEY)
        .classification,
    ).toBe("bearer");
    expect(classifyMeshToken("cashuBnotatoken", MY_PUBKEY).classification).toBe(
      "invalid",
    );
    expect(classifyMeshToken("", MY_PUBKEY).classification).toBe("invalid");
  });

  it("rejects duplicate proof secrets instead of inflating a mesh receive", () => {
    const secret = "aa".repeat(32);
    const token = encode([proof(secret, 2), proof(secret, 8)]);

    expect(classifyMeshToken(token, MY_PUBKEY)).toEqual({
      classification: "invalid",
      mintUrl: MINT_URL,
      amount: 0,
      unit: "sat",
    });
  });

  // A v2 keyset id travels shortened in a cashuB token and can only be
  // expanded against the mint's keysets, which the mesh path does not hold.
  // The lock lives in the proof secret, not the keyset id, so classification
  // must not depend on it: the redeem step resolves the id against the
  // wallet's keychain. Rejecting here silently dropped every Nut Drop from a
  // mint that had rotated to v2 keysets.
  const V2_KEYSET_ID =
    "01c352c0b47d42edb764bddf8c53d77b85f057157d92084d9d05e876251ecd8422";

  function encodeV2(secret: string, amount = 2): string {
    return getEncodedToken({
      mint: MINT_URL,
      unit: "sat",
      proofs: [{ ...proof(secret, amount), id: V2_KEYSET_ID }],
    });
  }

  it("classifies a token locked to me when its keyset id is a short v2 id", () => {
    expect(
      classifyMeshToken(encodeV2(p2pkSecret(MY_PUBKEY), 5), MY_PUBKEY),
    ).toEqual({
      classification: "locked-to-me",
      mintUrl: MINT_URL,
      amount: 5,
      unit: "sat",
    });
  });

  it("still separates other locks and bearer proofs under a short v2 keyset id", () => {
    expect(
      classifyMeshToken(encodeV2(p2pkSecret(OTHER_PUBKEY)), MY_PUBKEY)
        .classification,
    ).toBe("locked-to-other");
    expect(
      classifyMeshToken(encodeV2("aa".repeat(32)), MY_PUBKEY).classification,
    ).toBe("bearer");
  });
});

describe("meshTokenDedupeKey", () => {
  it("is stable for the same token and distinct for different tokens", () => {
    const a = encode([proof(p2pkSecret(MY_PUBKEY))]);
    const b = encode([proof(p2pkSecret(OTHER_PUBKEY))]);
    expect(meshTokenDedupeKey(a)).toBe(meshTokenDedupeKey(a));
    expect(meshTokenDedupeKey(a)).not.toBe(meshTokenDedupeKey(b));
    expect(meshTokenDedupeKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// redeem orchestrator
// ---------------------------------------------------------------------------

function entry(overrides: Partial<MeshRedeemEntry> = {}): MeshRedeemEntry {
  return {
    token: "cashuB...",
    mintUrl: MINT_URL,
    amount: 21,
    unit: "sat",
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    receivedAt: 0,
    ...overrides,
  };
}

function createQueue(initial: Record<string, MeshRedeemEntry>) {
  const statuses: Array<[string, string]> = [];
  const retries: string[] = [];
  return {
    port: {
      prune: () => {},
      entries: () => initial,
      markStatus: (hash: string, status: string): boolean => {
        statuses.push([hash, status]);
        return true;
      },
      scheduleRetry: (hash: string): "pending" | "failed" | null => {
        retries.push(hash);
        return "pending";
      },
    },
    statuses,
    retries,
  };
}

function fakeManager(trusted = true) {
  // Stable identity: the orchestrator aborts a drain if getManager() returns
  // a different object mid-drain (profile-switch guard).
  const manager = { mint: { isTrustedMint: async () => trusted } } as never;
  return () => manager;
}

describe("createMeshRedeemOrchestrator", () => {
  it("abandons a profile's drain when the profile changes during trust lookup", async () => {
    const queue = createQueue({ h1: entry() });
    const other = fakeManager()();
    const original = {
      mint: {
        isTrustedMint: async () => {
          current = other;
          return true;
        },
      },
    } as never;
    let current = original;
    const execute = vi.fn(async () => ({ historyEntryId: null }));
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: () => current,
      queue: queue.port,
      executeAutoRedeem: execute,
    });
    await orchestrator.drain();
    expect(execute).not.toHaveBeenCalled();
    expect(queue.statuses).toEqual([]);
    expect(queue.retries).toEqual([]);
  });

  it("redeems due trusted entries through executeAutoRedeem", async () => {
    const queue = createQueue({ h1: entry() });
    const redeemed: string[] = [];
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async ({ tokenString: token }) => {
        redeemed.push(token);
        return { historyEntryId: "hist1" };
      },
      onRedeemed: (hash, _entry, historyEntryId) => {
        expect([hash, historyEntryId]).toEqual(["h1", "hist1"]);
      },
    });
    await orchestrator.drain();
    expect(redeemed).toEqual(["cashuB..."]);
    expect(queue.statuses).toEqual([
      ["h1", "redeeming"],
      ["h1", "redeemed"],
    ]);
  });

  it("parks untrusted-mint entries without touching the wallet", async () => {
    const queue = createQueue({ h1: entry() });
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(false),
      queue: queue.port,
      executeAutoRedeem: async () => {
        throw new Error("must not be called");
      },
    });
    await orchestrator.drain();
    expect(queue.statuses).toEqual([["h1", "untrusted-mint"]]);
  });

  it("classifies errors: spent terminal, network retried, fatal failed", async () => {
    const queue = createQueue({
      spent: entry(),
      net: entry(),
      fatal: entry(),
    });
    const errors: Record<string, Error> = {
      spent: new Error("Token was already spent"),
      net: new Error("fetch failed: network down"),
      fatal: new Error("proof verification failed"),
    };
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async ({ tokenString: token }) => {
        throw errors[token as keyof typeof errors] ?? new Error("unknown");
      },
    });
    // Tokens double as keys for the fixture.
    queue.port.entries = () => ({
      spent: entry({ token: "spent" }),
      net: entry({ token: "net" }),
      fatal: entry({ token: "fatal" }),
    });
    await orchestrator.drain();
    expect(queue.statuses).toContainEqual(["spent", "spent"]);
    expect(queue.retries).toEqual(["net"]);
    expect(queue.statuses).toContainEqual(["fatal", "failed"]);
  });

  it("does not start a receive the queue refused to start", async () => {
    const queue = createQueue({ h1: entry() });
    queue.port.markStatus = (hash, status) => {
      queue.statuses.push([hash, status]);
      return status !== "redeeming";
    };
    const execute = vi.fn(async () => ({ historyEntryId: null }));
    const onRedeeming = vi.fn();
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: execute,
      onRedeeming,
    });
    await orchestrator.drain();
    expect(execute).not.toHaveBeenCalled();
    expect(onRedeeming).not.toHaveBeenCalled();
    expect(queue.statuses).toEqual([["h1", "redeeming"]]);
  });

  it("does not report a receive the queue refused to record", async () => {
    const queue = createQueue({ h1: entry() });
    queue.port.markStatus = (hash, status) => {
      queue.statuses.push([hash, status]);
      return status !== "redeemed";
    };
    const onRedeemed = vi.fn();
    const onFailed = vi.fn();
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async () => ({ historyEntryId: "hist1" }),
      onRedeemed,
      onFailed,
    });
    await orchestrator.drain();
    expect(onRedeemed).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("reports a failed attempt as the queue recorded it, and not when it refused", async () => {
    const entries = {
      spent: entry({ token: "spent" }),
      fatal: entry({ token: "fatal" }),
      net: entry({ token: "net" }),
      exhausted: entry({ token: "exhausted", attempts: 4 }),
      refused: entry({ token: "refused" }),
    };
    const queue = createQueue(entries);
    queue.port.markStatus = (hash, status) =>
      !(hash === "refused" && status !== "redeeming");
    queue.port.scheduleRetry = (hash) =>
      hash === "exhausted" ? "failed" : hash === "refused" ? null : "pending";
    const errors: Record<string, Error> = {
      spent: new Error("Token was already spent"),
      fatal: new Error("proof verification failed"),
      net: new Error("fetch failed: network down"),
      exhausted: new Error("fetch failed: network down"),
      refused: new Error("fetch failed: network down"),
    };
    const onFailed = vi.fn();
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async ({ tokenString }) => {
        throw errors[tokenString];
      },
      onFailed,
    });
    await orchestrator.drain();
    expect(
      onFailed.mock.calls.map(([hash, , recorded]) => [hash, recorded]),
    ).toEqual([
      ["spent", "spent"],
      ["fatal", "failed"],
      ["net", "retrying"],
      ["exhausted", "failed"],
    ]);
  });

  it("a drop queued while a drain runs is redeemed by one more run after it", async () => {
    const entries: Record<string, MeshRedeemEntry> = {
      a: entry({ token: "a" }),
    };
    const queue = createQueue(entries);
    const prune = vi.fn();
    queue.port.prune = prune;
    let releaseA!: () => void;
    const redeemed: string[] = [];
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async ({ tokenString: token }) => {
        if (token === "a")
          await new Promise<void>((resolve) => (releaseA = resolve));
        redeemed.push(token);
        // The fixture's queue does not move statuses; settle the entry so
        // a later run does not pick it again.
        entries[token] = entry({ token, status: "redeemed" });
        return { historyEntryId: null };
      },
    });

    const first = orchestrator.drain();
    await vi.waitFor(() => expect(releaseA).toBeTypeOf("function"));
    // B arrives (or a "try again" requeues it) while A is being redeemed;
    // two triggers during the run still mean one more run.
    entries.b = entry({ token: "b" });
    const second = orchestrator.drain();
    const third = orchestrator.drain();
    releaseA();
    await Promise.all([first, second, third]);

    expect(redeemed).toEqual(["a", "b"]);
    // Each run prunes once: A's run and exactly one more.
    expect(prune).toHaveBeenCalledTimes(2);
    expect(queue.statuses).toEqual([
      ["a", "redeeming"],
      ["a", "redeemed"],
      ["b", "redeeming"],
      ["b", "redeemed"],
    ]);
  });

  it("receives waiting entries whose time has come and resumes interrupted ones, nothing else", async () => {
    const entries: Record<string, MeshRedeemEntry> = {
      due: entry({ token: "due" }),
      retryDue: entry({ token: "retryDue", attempts: 2, nextAttemptAt: 1 }),
      backingOff: entry({
        token: "backingOff",
        attempts: 1,
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
      }),
      interrupted: entry({ token: "interrupted", status: "redeeming" }),
      interruptedRetryDue: entry({
        token: "interruptedRetryDue",
        status: "redeeming",
        attempts: 1,
        nextAttemptAt: 1,
      }),
      // An older build kept the retry time when it started the receive, and
      // the clock has since moved back: it still waits for that time.
      interruptedBackingOff: entry({
        token: "interruptedBackingOff",
        status: "redeeming",
        attempts: 1,
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
      }),
      redeemed: entry({ token: "redeemed", status: "redeemed" }),
      spent: entry({ token: "spent", status: "spent" }),
      untrusted: entry({ token: "untrusted", status: "untrusted-mint" }),
      refused: entry({ token: "refused", status: "failed", attempts: 2 }),
      exhausted: entry({ token: "exhausted", status: "failed", attempts: 5 }),
    };
    const queue = createQueue(entries);
    const received: string[] = [];
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      now: () => 1000,
      executeAutoRedeem: async ({ tokenString }) => {
        received.push(tokenString);
        return { historyEntryId: null };
      },
    });
    await orchestrator.drain();
    expect(received).toEqual([
      "due",
      "retryDue",
      "interrupted",
      "interruptedRetryDue",
    ]);
  });

  it("a drain with nothing arriving during it runs once", async () => {
    const queue = createQueue({ h1: entry() });
    const prune = vi.fn();
    queue.port.prune = prune;
    const orchestrator = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: async () => ({ historyEntryId: null }),
    });
    await orchestrator.drain();
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("gates on manager availability, restore status, and backoff windows", async () => {
    const queue = createQueue({
      h1: entry({ nextAttemptAt: Number.MAX_SAFE_INTEGER }),
    });
    const execute = vi.fn(async () => ({ historyEntryId: null }));

    const noManager = createMeshRedeemOrchestrator({
      getManager: () => null,
      queue: queue.port,
      executeAutoRedeem: execute,
    });
    await noManager.drain();

    const restoring = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: execute,
      isRestoreSettled: () => false,
    });
    await restoring.drain();

    const backoff = createMeshRedeemOrchestrator({
      getManager: fakeManager(),
      queue: queue.port,
      executeAutoRedeem: execute,
    });
    await backoff.drain();

    expect(execute).not.toHaveBeenCalled();
    expect(queue.statuses).toEqual([]);
  });
});

describe("classifyMeshRedeemError", () => {
  it("maps message patterns to kinds", () => {
    expect(classifyMeshRedeemError(new Error("Token already   spent"))).toBe(
      "spent",
    );
    expect(classifyMeshRedeemError(new Error("request timed out"))).toBe(
      "network",
    );
    expect(
      classifyMeshRedeemError(new Error("key pair not found for keyset")),
    ).toBe("retryable");
    expect(classifyMeshRedeemError(new Error("bad signature"))).toBe("fatal");
  });
});
