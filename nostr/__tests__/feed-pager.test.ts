import { describe, expect, it, vi } from "vitest";
import { ok } from "neverthrow";
import { answered, failed, unsupported } from "../src/tiers";
import {
  createFeedPager,
  createNostrDataLayer,
  createNaggTier,
  feedItemId,
  type FeedBundle,
  type FeedItem,
  type FeedTier,
} from "../src/facade";
import { createRelayTier } from "../src/facade/relay";
import { createNaggClient } from "../src/transport";

const event = (id: string, created_at = 100) => ({
  id,
  created_at,
  pubkey: "a".repeat(64),
  kind: 1,
  tags: [],
  content: "",
});
const note = (id: string, time = 100): FeedItem => ({
  type: "note",
  event: event(id, time),
});
function bundle(items: FeedItem[], hasMore?: boolean): FeedBundle {
  const last = items.at(-1);
  const boundary = last?.type === "note" ? last.event : last?.repostEvent;
  return {
    itemsById: new Map(items.map((item) => [feedItemId(item), item])),
    manifest: { orderBy: "created_at", elements: items.map(feedItemId) },
    stats: {},
    profiles: {},
    quoted: {},
    hasMore,
    cursor: boundary
      ? { createdAt: boundary.created_at, id: boundary.id }
      : null,
  };
}
function tier(
  name: FeedTier["tier"],
  ...responses: Awaited<ReturnType<FeedTier["feedPage"]>>[]
) {
  const feedPage = vi.fn<FeedTier["feedPage"]>(
    async () => responses.shift() ?? unsupported(),
  );
  return { tier: name, feedPage };
}
const down = () => failed({ type: "network", message: "offline", cause: null });
const ids = (
  page: Awaited<ReturnType<ReturnType<typeof createFeedPager>["nextPage"]>>,
) => page.pages.flatMap((p) => p.items.map(feedItemId));

describe("per-tier feed pager", () => {
  it.each(["primal", "relay"] as const)(
    "continues %s history when the provider caps pages below the requested size",
    async (source) => {
      const provider = tier(
        source,
        answered(bundle([note("newer", 200)])),
        answered(bundle([note("older", 100)])),
        answered(bundle([])),
      );
      const pager = createFeedPager({
        tiers: [provider],
        spec: { kind: "following-recent", authors: ["a".repeat(64)] },
        limit: 30,
      });
      const first = await pager.nextPage();
      expect(ids(first)).toEqual(["newer"]);
      expect(first.hasMore).toBe(true);
      expect(ids(await pager.nextPage())).toEqual(["older"]);
      expect(provider.feedPage.mock.calls[1][0].cursor).toEqual({
        createdAt: 200,
        id: "newer",
      });
      expect((await pager.nextPage()).hasMore).toBe(false);
    },
  );

  it("falls back on page 2 then retries nagg after 1s ahead of Primal", async () => {
    let now = 0;
    const nagg = tier(
      "nagg",
      answered(bundle([note("a")], true)),
      down(),
      answered(bundle([note("d")], false)),
    );
    const primal = tier(
      "primal",
      answered(bundle([note("b", 90), note("c", 80)])),
    );
    const pager = createFeedPager({
      tiers: [nagg, primal],
      spec: { kind: "for-you" },
      limit: 1,
      clock: () => now,
    });
    expect(ids(await pager.nextPage())).toEqual(["a"]);
    expect(ids(await pager.nextPage())).toEqual(["b"]);
    expect(primal.feedPage.mock.calls[0][0].spec).toEqual({
      kind: "following-recent",
    });
    now = 1_000;
    expect(ids(await pager.nextPage())).toEqual(["d"]);
    expect(nagg.feedPage).toHaveBeenCalledTimes(3);
    expect(ids(await pager.nextPage())).toEqual(["c"]);
  });
  it("drops cross-tier notes and reposts of the same original", async () => {
    const repost: FeedItem = {
      type: "repost",
      repostEvent: { ...event("repost"), kind: 6 },
      originalEventId: "same",
    };
    const pager = createFeedPager({
      tiers: [
        tier("nagg", answered(bundle([note("same")], false))),
        tier("primal", answered(bundle([note("same"), note("new")]))),
        tier("relay", answered(bundle([repost, note("older", 90)]))),
      ],
      spec: { kind: "for-you" },
      limit: 5,
    });
    expect(ids(await pager.nextPage())).toEqual(["same", "new", "older"]);
  });
  it("forwards the real relay boundary id and never repeats it", async () => {
    const events = ["a", "b", "c"].map((id, i) => event(id, 100 - i));
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok(events.slice(0, 2)))
      .mockResolvedValueOnce(ok(events.slice(1)));
    const relay = createRelayTier({ connection: { request } });
    const feedPage = vi.fn(relay.feedPage!);
    const pager = createFeedPager({
      tiers: [{ tier: "relay", feedPage }],
      spec: { kind: "user", pubkey: "viewer" },
      limit: 1,
    });
    expect(ids(await pager.nextPage())).toEqual(["a"]);
    expect(ids(await pager.nextPage())).toEqual(["b"]);
    expect(ids(await pager.nextPage())).toEqual(["c"]);
    expect(feedPage.mock.calls[1][0].cursor).toEqual({
      createdAt: 99,
      id: "b",
    });
  });
  it("keeps hasMore in backoff and ends after all lanes finish", async () => {
    let now = 0;
    const nagg = tier("nagg", down(), answered(bundle([], false)));
    const pager = createFeedPager({
      tiers: [nagg, tier("primal", unsupported())],
      spec: { kind: "for-you" },
      clock: () => now,
    });
    expect(await pager.nextPage()).toMatchObject({
      hasMore: true,
      retryAfterMs: 1_000,
    });
    now = 100;
    expect(await pager.nextPage()).toMatchObject({
      hasMore: true,
      retryAfterMs: 900,
    });
    expect(nagg.feedPage).toHaveBeenCalledTimes(1);
    now = 1_000;
    expect(await pager.nextPage()).toMatchObject({ hasMore: false });
  });
  it("advances ranked offset by served slots, retaining overflow", async () => {
    const nagg = tier(
      "nagg",
      answered(bundle([note("seen"), note("b"), note("c"), note("d")], true)),
      answered(bundle([], false)),
    );
    const pager = createFeedPager({
      tiers: [nagg],
      spec: { kind: "for-you" },
      limit: 2,
      seen: ["seen"],
    });
    expect(ids(await pager.nextPage())).toEqual(["b", "c"]);
    expect(ids(await pager.nextPage())).toEqual(["d"]);
    await pager.nextPage();
    expect(nagg.feedPage.mock.calls[1][0].offset).toBe(4);
  });
  it("allows one same-second grace turn, then exhausts", async () => {
    const relay = tier(
      "relay",
      ...[
        ["a", "b"],
        ["c", "d"],
        ["e", "f"],
      ].map((pair) => answered(bundle(pair.map((id) => note(id))))),
    );
    const pager = createFeedPager({
      tiers: [relay],
      spec: { kind: "user", pubkey: "viewer" },
      limit: 1,
    });
    const collected: string[] = [];
    for (let i = 0; i < 6; i++) collected.push(...ids(await pager.nextPage()));
    expect(collected).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect((await pager.nextPage()).hasMore).toBe(false);
    expect(relay.feedPage.mock.calls.map(([r]) => r.cursor)).toEqual([
      null,
      { createdAt: 100, id: "b" },
      { createdAt: 100, id: "d" },
    ]);
  });
  it("rolls back cursor, seen and exhaustion on mid-waterfall abort", async () => {
    const controller = new AbortController();
    const nagg = tier(
      "nagg",
      answered(bundle([note("a")], false)),
      answered(bundle([note("a")], false)),
    );
    const primal = tier("primal", unsupported());
    primal.feedPage.mockImplementationOnce(async () => {
      controller.abort();
      return down();
    });
    const pager = createFeedPager({
      tiers: [nagg, primal],
      spec: { kind: "for-you" },
      limit: 2,
    });
    await expect(pager.nextPage(controller.signal)).rejects.toThrow();
    expect(ids(await pager.nextPage())).toEqual(["a"]);
    expect(nagg.feedPage.mock.calls.map(([r]) => r.offset)).toEqual([0, 0]);
  });
  it.each([404, 501])(
    "turns nagg HTTP %s into unsupported for its lifetime",
    async (status) => {
      const fetchImpl = Object.assign(
        vi.fn(async () => new Response("", { status })),
        { preconnect: vi.fn() },
      );
      const nagg = createNaggTier({
        client: createNaggClient({
          appView: { baseUrl: "https://nagg.test" },
          fetchImpl,
        }),
      });
      let now = 0;
      const pager = createFeedPager({
        tiers: [nagg, tier("primal", down(), down())],
        spec: { kind: "for-you" },
        clock: () => now,
      });
      expect((await pager.nextPage()).hasMore).toBe(true);
      now = 70_000;
      await pager.nextPage();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it("ingests every answered bundle including buffered items", async () => {
    const layer = createNostrDataLayer({
      tiers: [tier("nagg", answered(bundle([note("a"), note("b")], false)))],
    });
    const pager = layer.createFeedPager({
      spec: { kind: "for-you" },
      limit: 1,
    });
    expect((await pager.nextPage()).hasMore).toBe(true);
    expect(layer.cache.getNote("b")).toBeDefined();
    expect(ids(await pager.nextPage())).toEqual(["b"]);
    expect((await pager.nextPage()).hasMore).toBe(false);
  });
});

it("uses the complete pager backoff schedule without the nagg surface cooldown", async () => {
  let now = 0;
  const fetchImpl = Object.assign(
    vi.fn(async () => {
      throw new Error("offline");
    }),
    { preconnect: vi.fn() },
  );
  const nagg = createNaggTier({
    client: createNaggClient({
      appView: { baseUrl: "https://nagg.test" },
      fetchImpl,
    }),
  });
  const pager = createFeedPager({
    tiers: [nagg],
    spec: { kind: "for-you" },
    clock: () => now,
  });
  for (const delay of [1_000, 4_000, 15_000, 60_000, 60_000]) {
    expect(await pager.nextPage()).toMatchObject({
      hasMore: true,
      retryAfterMs: delay,
    });
    now += delay;
  }
  expect(fetchImpl).toHaveBeenCalledTimes(5);
});

it("resolves following authors before the relay chronological fallback", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      ok([{ ...event("follows"), kind: 3, tags: [["p", "followed-author"]] }]),
    )
    .mockResolvedValueOnce(ok([event("post")]));
  const pager = createFeedPager({
    tiers: [
      tier("nagg", unsupported()),
      createRelayTier({ connection: { request } }),
    ],
    spec: { kind: "following-popular", viewerPubkey: "viewer" },
    limit: 1,
  });
  const page = await pager.nextPage();
  expect(page).toMatchObject({ showingRecent: true, sources: ["relay"] });
  expect(ids(page)).toEqual(["post"]);
  expect(request.mock.calls[1][0]).toEqual([
    { kinds: [1], authors: ["followed-author"], limit: 2 },
  ]);
});

it("disposal aborts an in-flight lane without falling through", async () => {
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const nagg: FeedTier = {
    tier: "nagg",
    feedPage: ({ signal }) =>
      new Promise((resolve) => {
        started();
        signal?.addEventListener("abort", () => resolve(down()), {
          once: true,
        });
      }),
  };
  const primal = tier("primal", answered(bundle([note("late")])));
  const pager = createFeedPager({
    tiers: [nagg, primal],
    spec: { kind: "for-you" },
  });
  const pending = pager.nextPage();
  await began;
  pager.dispose();
  await expect(pending).rejects.toThrow();
  expect(primal.feedPage).not.toHaveBeenCalled();
});
