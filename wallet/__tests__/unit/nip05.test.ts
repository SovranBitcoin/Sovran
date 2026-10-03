import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNip05Pubkey,
  verifyNip05,
  parseNip05Identifier,
} from "../../src/nip05";
import { resolveRecipientPubkey } from "../../src/recipient";

const PUBKEY = "a".repeat(64);
const ODELL_PUBKEY =
  "04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9";

function mockJsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number },
): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200 });
}

describe("NIP-05 recipient resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the lightning-address well-known URL and returns lowercase pubkey", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      mockJsonResponse({
        names: {
          alice: PUBKEY,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNip05Pubkey("alice@example.com")).resolves.toBe(PUBKEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.com/.well-known/nostr.json?name=alice",
    );
  });

  it("rejects a redirected identity response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Object.defineProperty(
          mockJsonResponse({ names: { alice: PUBKEY } }),
          "redirected",
          { value: true },
        ),
      ),
    );
    await expect(fetchNip05Pubkey("alice@example.com")).resolves.toBeNull();
  });

  it("checks the exact selected key without trusting a profile claim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockJsonResponse({ names: { alice: PUBKEY } })),
    );
    await expect(verifyNip05("alice@example.com", PUBKEY)).resolves.toEqual({
      status: "verified",
      identifier: "alice@example.com",
    });
    await expect(
      verifyNip05("alice@example.com", "b".repeat(64)),
    ).resolves.toEqual({ status: "mismatch", identifier: "alice@example.com" });
  });

  it.each([
    "alice@example.com/path",
    "a@127.0.0.1",
    "a@host.local",
    "a@bad..com",
    "a@-bad.com",
    "a@host.com:443",
    "a@x@host.com",
  ])("rejects unsafe identifier %s without fetching", async (address) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(parseNip05Identifier(address)).toBeNull();
    await expect(verifyNip05(address, PUBKEY)).resolves.toMatchObject({
      status: "error",
      reason: "invalid",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes the root name and rejects noncanonical hex from the domain", async () => {
    expect(parseNip05Identifier("Example.com")?.identifier).toBe(
      "_@example.com",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockJsonResponse({ names: { _: PUBKEY.toUpperCase() } }),
      ),
    );
    await expect(verifyNip05("example.com", PUBKEY)).resolves.toMatchObject({
      status: "error",
      reason: "response",
    });
  });

  it("bounds a stalled response body, even when fetch ignores cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers(),
        text: () => new Promise(() => {}),
      })),
    );
    await expect(
      verifyNip05("alice@example.com", PUBKEY, { timeoutMs: 10 }),
    ).resolves.toMatchObject({ status: "error", reason: "network" });
  });

  it("rejects oversized response text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockJsonResponse({
          names: { alice: PUBKEY },
          padding: "x".repeat(33_000),
        }),
      ),
    );
    await expect(
      verifyNip05("alice@example.com", PUBKEY),
    ).resolves.toMatchObject({ status: "error", reason: "response" });
  });

  it("accepts mixed-case names but rejects ambiguous case variants", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockJsonResponse({ names: { Alice: PUBKEY } })),
    );
    await expect(fetchNip05Pubkey("Alice@example.com")).resolves.toBe(PUBKEY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockJsonResponse({ names: { Alice: PUBKEY, alice: "b".repeat(64) } }),
      ),
    );
    await expect(
      verifyNip05("Alice@example.com", PUBKEY),
    ).resolves.toMatchObject({ status: "error", reason: "response" });
  });

  it("matches providers that lowercase a mixed-case local part", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockJsonResponse({
          names: {
            alice: PUBKEY,
          },
        }),
      ),
    );

    await expect(fetchNip05Pubkey("Alice@example.com")).resolves.toBe(PUBKEY);
  });

  it("accepts the real Primal response shape for odell@primal.net", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      mockJsonResponse({
        names: {
          odell: ODELL_PUBKEY,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNip05Pubkey("odell@primal.net")).resolves.toBe(
      ODELL_PUBKEY,
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://primal.net/.well-known/nostr.json?name=odell",
    );
  });

  it("returns null for onion hosts without starting a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNip05Pubkey("alice@example.onion")).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for invalid responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockJsonResponse({
          names: {
            alice: "not-a-pubkey",
          },
        }),
      ),
    );

    await expect(fetchNip05Pubkey("alice@example.com")).resolves.toBeNull();
  });

  it.each(["constructor", "__proto__", "toString"])(
    "returns null when the local part %s names an inherited Object member",
    async (local) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => mockJsonResponse({ names: { alice: PUBKEY } })),
      );

      await expect(
        fetchNip05Pubkey(`${local}@example.com`),
      ).resolves.toBeNull();
    },
  );

  it("only resolves lightning-address targets", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveRecipientPubkey("lnbc1mockinvoice"),
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
