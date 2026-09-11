import { describe, test, expect, vi } from "vitest";
import { ok, err } from "neverthrow";
import { createNaggClient } from "../src/transport";
import { createNaggTier, createNostrDataLayer } from "../src/facade";
import { createPrimalTier, type PrimalConnection } from "../src/facade/primal";
import { createRelayTier, type RelayConnection } from "../src/facade/relay";

const PUB = "a".repeat(64);
const NOTE = {
  id: "b".repeat(64),
  pubkey: PUB,
  kind: 1,
  content: "A profile post",
  tags: [],
  created_at: 200,
};

describe("profile posts without nagg", () => {
  test("uses Primal cached posts before raw relays when nagg fails", async () => {
    const primalRequest = vi.fn<PrimalConnection["request"]>(async () =>
      ok([NOTE]),
    );
    const relayRequest = vi.fn(async () => ok([]));
    const layer = createNostrDataLayer({
      tiers: [
        createNaggTier({
          client: createNaggClient({
            appView: { baseUrl: "https://nagg.test" },
            fetchImpl: (async () => {
              throw new Error("nagg unavailable");
            }) as unknown as typeof fetch,
          }),
        }),
        createPrimalTier({ connection: { request: primalRequest } }),
        createRelayTier({ connection: { request: relayRequest } }),
      ],
    });

    const page = (
      await layer.getFeedPage({
        spec: { kind: "user", pubkey: PUB },
        limit: 50,
      })
    )._unsafeUnwrap();
    expect(page.items).toEqual([{ type: "note", event: NOTE }]);
    expect(page.tier).toBe("primal");
    expect(primalRequest).toHaveBeenCalledWith(
      {
        verb: "feed",
        params: {
          pubkey: PUB,
          notes: "authored",
          include_replies: false,
          limit: 50,
        },
      },
      expect.anything(),
    );
    expect(relayRequest).not.toHaveBeenCalled();
    expect(layer.cache.getNote(NOTE.id)?.content).toBe(NOTE.content);
  });

  test("keeps nagg priority when its profile feed is available", async () => {
    const primalRequest = vi.fn<PrimalConnection["request"]>(async () =>
      ok([NOTE]),
    );
    const layer = createNostrDataLayer({
      tiers: [
        createNaggTier({
          client: createNaggClient({
            appView: { baseUrl: "https://nagg.test" },
            fetchImpl: (async () =>
              new Response(
                JSON.stringify({
                  order: [NOTE.id],
                  orderBy: "created_at",
                  events: [NOTE],
                  aggregates: {},
                }),
              )) as unknown as typeof fetch,
          }),
        }),
        createPrimalTier({ connection: { request: primalRequest } }),
      ],
    });
    const page = (
      await layer.getFeedPage({ spec: { kind: "user", pubkey: PUB } })
    )._unsafeUnwrap();
    expect(page.tier).toBe("nagg");
    expect(page.items).toHaveLength(1);
    expect(primalRequest).not.toHaveBeenCalled();
  });

  test.each(["empty", "failed"] as const)(
    "uses raw relay posts when Primal is %s and nagg is disabled",
    async (outcome) => {
      const relayRequest = vi.fn<RelayConnection["request"]>(async () =>
        ok([NOTE]),
      );
      const layer = createNostrDataLayer({
        tiers: [
          createPrimalTier({
            connection: {
              request: async () =>
                outcome === "empty"
                  ? ok([])
                  : err({
                      type: "network",
                      message: "offline",
                      cause: "offline",
                    }),
            },
          }),
          createRelayTier({ connection: { request: relayRequest } }),
        ],
      });
      const page = (
        await layer.getFeedPage({
          spec: { kind: "user", pubkey: PUB },
          limit: 50,
        })
      )._unsafeUnwrap();
      expect(page.tier).toBe("relay");
      expect(page.items).toEqual([{ type: "note", event: NOTE }]);
      expect(relayRequest).toHaveBeenCalledWith(
        [{ kinds: [1], authors: [PUB], limit: 50 }],
        expect.anything(),
      );
      expect(layer.cache.getNote(NOTE.id)?.content).toBe(NOTE.content);
    },
  );

  test("forwards profile paging, timeout and cancellation to Primal", async () => {
    const request = vi.fn<PrimalConnection["request"]>(async () => ok([NOTE]));
    const layer = createNostrDataLayer({
      tiers: [createPrimalTier({ connection: { request } })],
    });
    const signal = new AbortController().signal;
    await layer.getFeedPage({
      spec: { kind: "user", pubkey: PUB },
      cursor: { createdAt: 300, id: "d".repeat(64) },
      limit: 10,
      timeoutMs: 500,
      signal,
    });
    expect(request).toHaveBeenCalledWith(
      {
        verb: "feed",
        params: {
          pubkey: PUB,
          notes: "authored",
          include_replies: false,
          limit: 10,
          until: 300,
        },
      },
      { timeoutMs: 500, signal },
    );
  });
});
