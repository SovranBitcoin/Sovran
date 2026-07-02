import { describe, expect, it, vi } from "vitest";
import {
  PaymentRequest,
  PaymentRequestTransportType,
  decodePaymentRequest,
} from "@cashu/cashu-ts";
import type { Manager } from "@cashu/coco-core";

import {
  ensureStandingPaymentRequest,
  rotateStandingPaymentRequest,
  standingPaymentRequestKey,
} from "../../src/payment-request-receive";
import type { ReusableQuoteIdentityStore } from "../../src/quotes/reusable";

const MINTS = ["https://mint.example.com"];

/** A realistic coco encodedRequest: amount floor 1, nostr transport. */
function encodedFixture(requestId: string): string {
  return new PaymentRequest(
    [
      {
        type: PaymentRequestTransportType.NOSTR,
        target: "nprofile1example",
        tags: [["n", "17"]],
      },
    ],
    requestId,
    1,
    "sat",
    MINTS,
    undefined,
    false,
  ).toEncodedRequest();
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-1",
    requestId: "req-1",
    encodedRequest: encodedFixture("req-1"),
    state: "active",
    transport: "nostr",
    unit: "sat",
    mints: MINTS,
    singleUse: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function mockManager(
  overrides: { get?: unknown; create?: unknown; cancel?: unknown } = {},
) {
  return {
    paymentRequests: {
      incoming: {
        get: overrides.get ?? vi.fn().mockResolvedValue(null),
        create: overrides.create ?? vi.fn().mockResolvedValue(operation()),
        cancel:
          overrides.cancel ??
          vi.fn().mockResolvedValue(operation({ state: "cancelled" })),
      },
    },
  } as unknown as Manager;
}

function memoryStore(
  initial: Record<string, string> = {},
): ReusableQuoteIdentityStore & { map: Record<string, string> } {
  const map = { ...initial };
  return {
    map,
    get: (key) => map[key],
    set: (key, id) => {
      map[key] = id;
    },
  };
}

const KEY = standingPaymentRequestKey("sat");
const INPUT = { unit: "sat", mints: MINTS };

describe("ensureStandingPaymentRequest", () => {
  it("creates a reusable 1-unit-floor op and records it when none is recorded", async () => {
    const create = vi.fn().mockResolvedValue(operation());
    const manager = mockManager({ create });
    const store = memoryStore();

    const standing = await ensureStandingPaymentRequest(manager, INPUT, store);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1,
        unit: "sat",
        mints: MINTS,
        singleUse: false,
        transport: "nostr",
        requestId: expect.any(String),
      }),
    );
    expect(store.map[KEY]).toBe("op-1");
    expect(standing.operationId).toBe("op-1");
  });

  it("re-encodes the display request WITHOUT the floor amount", async () => {
    const manager = mockManager({
      get: vi.fn().mockResolvedValue(operation()),
    });
    const store = memoryStore({ [KEY]: "op-1" });

    const standing = await ensureStandingPaymentRequest(manager, INPUT, store);

    const display = decodePaymentRequest(standing.encodedRequest);
    expect(display.amount).toBeUndefined();
    expect(display.id).toBe("req-1");
    expect(display.mints).toEqual(MINTS);
    expect(display.transport?.[0]?.type).toBe("nostr");
    // The durable coco op keeps its floor — only the DISPLAY drops it.
    // (cashu-ts v4 decodes amounts as Amount value objects.)
    expect(
      Number(decodePaymentRequest(encodedFixture("req-1")).amount?.toString()),
    ).toBe(1);
  });

  it("reuses the recorded active reusable op without creating", async () => {
    const get = vi.fn().mockResolvedValue(operation());
    const create = vi.fn();
    const manager = mockManager({ get, create });
    const store = memoryStore({ [KEY]: "op-1" });

    const standing = await ensureStandingPaymentRequest(manager, INPUT, store);

    expect(get).toHaveBeenCalledWith("op-1");
    expect(create).not.toHaveBeenCalled();
    expect(standing.operationId).toBe("op-1");
  });

  it("re-creates when the recorded op is cancelled, single-use, or missing", async () => {
    for (const recorded of [
      null,
      operation({ state: "cancelled" }),
      operation({ singleUse: true }),
    ]) {
      const create = vi
        .fn()
        .mockResolvedValue(
          operation({
            id: "op-2",
            requestId: "req-2",
            encodedRequest: encodedFixture("req-2"),
          }),
        );
      const manager = mockManager({
        get: vi.fn().mockResolvedValue(recorded),
        create,
      });
      const store = memoryStore({ [KEY]: "op-1" });

      const standing = await ensureStandingPaymentRequest(
        manager,
        INPUT,
        store,
      );
      expect(create).toHaveBeenCalledOnce();
      expect(standing.operationId).toBe("op-2");
      expect(store.map[KEY]).toBe("op-2");
    }
  });
});

describe("rotateStandingPaymentRequest", () => {
  it("cancels the recorded op and records a fresh one with a new request id", async () => {
    const cancel = vi.fn().mockResolvedValue(operation({ state: "cancelled" }));
    const create = vi
      .fn()
      .mockResolvedValue(
        operation({
          id: "op-2",
          requestId: "req-2",
          encodedRequest: encodedFixture("req-2"),
        }),
      );
    const manager = mockManager({ cancel, create });
    const store = memoryStore({ [KEY]: "op-1" });

    const standing = await rotateStandingPaymentRequest(manager, INPUT, store);

    expect(cancel).toHaveBeenCalledWith("op-1", "rotated");
    expect(standing.operationId).toBe("op-2");
    expect(store.map[KEY]).toBe("op-2");
  });

  it("survives a cancel failure (already terminal) and still creates", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("not active"));
    const create = vi.fn().mockResolvedValue(operation({ id: "op-3" }));
    const manager = mockManager({ cancel, create });
    const store = memoryStore({ [KEY]: "op-1" });

    const standing = await rotateStandingPaymentRequest(manager, INPUT, store);
    expect(standing.operationId).toBe("op-3");
    expect(store.map[KEY]).toBe("op-3");
  });
});
