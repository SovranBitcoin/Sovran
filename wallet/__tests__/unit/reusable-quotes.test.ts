import { describe, expect, it, vi } from "vitest";
import type { Manager } from "@cashu/coco-core";

import {
  ensureReusableMintQuote,
  rotateReusableMintQuote,
  reusableQuoteKey,
  type ReusableQuoteIdentityStore,
} from "../../src/quotes/reusable";

const MINT = "https://mint.example.com";

function quote(overrides: Record<string, unknown> = {}) {
  return {
    mintUrl: MINT,
    method: "onchain",
    quoteId: "standing-1",
    request: "bc1qstandingaddress",
    unit: "sat",
    reusable: true,
    expiry: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function mockManager(overrides: { get?: unknown; create?: unknown } = {}) {
  return {
    quotes: {
      mint: {
        get: overrides.get ?? vi.fn().mockResolvedValue(null),
        create: overrides.create ?? vi.fn().mockResolvedValue(quote()),
      },
    },
  } as unknown as Manager;
}

function memoryStore(
  initial: Record<string, string> = {},
): ReusableQuoteIdentityStore & {
  map: Record<string, string>;
} {
  const map = { ...initial };
  return {
    map,
    get: (key) => map[key],
    set: (key, quoteId) => {
      map[key] = quoteId;
    },
  };
}

describe("ensureReusableMintQuote (identity-store singleton)", () => {
  const input = { mintUrl: MINT, method: "onchain" as const, unit: "sat" };
  const key = reusableQuoteKey(input);

  it("creates and records a quote when none is recorded", async () => {
    const create = vi.fn().mockResolvedValue(quote());
    const manager = mockManager({ create });
    const store = memoryStore();

    const resolved = await ensureReusableMintQuote(manager, input, store);

    expect(create).toHaveBeenCalledWith({
      mintUrl: MINT,
      method: "onchain",
      unit: "sat",
    });
    expect(store.map[key]).toBe("standing-1");
    expect(resolved.quoteId).toBe("standing-1");
  });

  it("returns the recorded quote without creating", async () => {
    const get = vi.fn().mockResolvedValue(quote());
    const create = vi.fn();
    const manager = mockManager({ get, create });
    const store = memoryStore({ [key]: "standing-1" });

    const resolved = await ensureReusableMintQuote(manager, input, store);

    expect(get).toHaveBeenCalledWith({ mintUrl: MINT, quoteId: "standing-1" });
    expect(create).not.toHaveBeenCalled();
    expect(resolved.quoteId).toBe("standing-1");
  });

  it("is not displaced by newer fixed-amount quotes (collision regression)", async () => {
    // A fixed-amount onchain receive creates its own reusable quote — shape
    // identical, newer createdAt. The standing tab must keep the RECORDED
    // quote, not adopt the newest pending one.
    const get = vi.fn().mockResolvedValue(quote({ createdAt: 1_000 }));
    const create = vi
      .fn()
      .mockResolvedValue(quote({ quoteId: "fixed-2", createdAt: 9_999 }));
    const manager = mockManager({ get, create });
    const store = memoryStore({ [key]: "standing-1" });

    const resolved = await ensureReusableMintQuote(manager, input, store);

    expect(resolved.quoteId).toBe("standing-1");
    expect(create).not.toHaveBeenCalled();
    expect(store.map[key]).toBe("standing-1");
  });

  it("re-creates and re-records when the recorded quote expired", async () => {
    const expired = quote({ expiry: 1 }); // long past
    const fresh = quote({ quoteId: "standing-2" });
    const get = vi.fn().mockResolvedValue(expired);
    const create = vi.fn().mockResolvedValue(fresh);
    const manager = mockManager({ get, create });
    const store = memoryStore({ [key]: "standing-1" });

    const resolved = await ensureReusableMintQuote(manager, input, store);

    expect(create).toHaveBeenCalledOnce();
    expect(resolved.quoteId).toBe("standing-2");
    expect(store.map[key]).toBe("standing-2");
  });

  it("re-creates when the recorded quote no longer resolves", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue(quote({ quoteId: "standing-3" }));
    const manager = mockManager({ get, create });
    const store = memoryStore({ [key]: "gone-1" });

    const resolved = await ensureReusableMintQuote(manager, input, store);

    expect(resolved.quoteId).toBe("standing-3");
    expect(store.map[key]).toBe("standing-3");
  });

  it("treats null expiry as never-expiring", async () => {
    const get = vi.fn().mockResolvedValue(quote({ expiry: null }));
    const create = vi.fn();
    const manager = mockManager({ get, create });
    const store = memoryStore({ [key]: "standing-1" });

    await ensureReusableMintQuote(manager, input, store);
    expect(create).not.toHaveBeenCalled();
  });

  it("treats expiry 0 as never-expiring (field regression: bolt12 offers)", async () => {
    // Some mints send expiry 0 as a "no expiry" sentinel for reusable
    // quotes; reading it as a 1970 timestamp rotated the standing bolt12
    // offer on every tab open.
    const get = vi
      .fn()
      .mockResolvedValue(
        quote({ method: "bolt12", quoteId: "offer-1", expiry: 0 }),
      );
    const create = vi.fn();
    const manager = mockManager({ get, create });
    const bolt12Input = {
      mintUrl: MINT,
      method: "bolt12" as const,
      unit: "sat",
    };
    const store = memoryStore({ [reusableQuoteKey(bolt12Input)]: "offer-1" });

    const resolved = await ensureReusableMintQuote(manager, bolt12Input, store);
    expect(create).not.toHaveBeenCalled();
    expect(resolved.quoteId).toBe("offer-1");
  });
});

describe("rotateReusableMintQuote", () => {
  const input = { mintUrl: MINT, method: "onchain" as const, unit: "sat" };
  const key = reusableQuoteKey(input);

  it("creates a fresh quote and re-records it, retiring the standing one", async () => {
    const create = vi.fn().mockResolvedValue(quote({ quoteId: "standing-2" }));
    const manager = mockManager({ create });
    const store = memoryStore({ [key]: "standing-1" });

    const rotated = await rotateReusableMintQuote(
      manager,
      input,
      store,
      "manual",
    );

    expect(create).toHaveBeenCalledWith({
      mintUrl: MINT,
      method: "onchain",
      unit: "sat",
    });
    expect(rotated.quoteId).toBe("standing-2");
    expect(store.map[key]).toBe("standing-2");
  });

  it("rotates even when nothing was recorded (first address counts too)", async () => {
    const create = vi.fn().mockResolvedValue(quote({ quoteId: "fresh-1" }));
    const manager = mockManager({ create });
    const store = memoryStore();

    await rotateReusableMintQuote(manager, input, store, "deposit_received");
    expect(store.map[key]).toBe("fresh-1");
  });

  it("subsequent ensure reuses the rotated quote", async () => {
    const create = vi.fn().mockResolvedValue(quote({ quoteId: "standing-2" }));
    const get = vi.fn().mockResolvedValue(quote({ quoteId: "standing-2" }));
    const manager = mockManager({ create, get });
    const store = memoryStore({ [key]: "standing-1" });

    await rotateReusableMintQuote(manager, input, store, "manual");
    const resolved = await ensureReusableMintQuote(manager, input, store);

    expect(create).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ mintUrl: MINT, quoteId: "standing-2" });
    expect(resolved.quoteId).toBe("standing-2");
  });
});
