import { describe, expect, test } from "vitest";
import {
  authoredReplyChainInput,
  dmEnvelopesAppView,
  followedPubkeySource,
  followingPopularRankedEventsInput,
  followingRecentEventsInput,
  followingRepliesEventsInput,
  forYouRankedEventsInput,
  globalTrendingRankedEventsInput,
  mergeRelevantReplyNodes,
  notificationsInput,
  PROFILE_EVENTS_SEARCH_QUERY,
  PROFILE_SEARCH_QUERY,
  profileEventsSearchInput,
  profileSearchInput,
  recentNotesEventsInput,
  shuffleInput,
  threadReplyRankInput,
  withEventExclusions,
  withRankedTargetExclusions,
} from "../src/recipes";
import { NaggProfileSearchDataSchema } from "../src/schemas";

const root = {
  id: "1".repeat(64),
  pubkey: "a".repeat(64),
  kind: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  content: "root",
  tags: [],
};

function reply(idChar: string, parentId: string, pubkey = root.pubkey) {
  return {
    id: idChar.repeat(64),
    pubkey,
    kind: 1,
    createdAt: `2026-01-01T00:00:0${Number.parseInt(idChar, 16) % 9}.000Z`,
    content: idChar,
    tags: [["e", parentId, "", "reply"]],
  };
}

describe("rank recipes", () => {
  test("profile search query exposes separate search and profile scores", () => {
    expect(profileSearchInput({ query: "jack" })).toEqual({
      query: "jack",
      limit: 10,
      sort: "globalPagerank",
    });
    expect(PROFILE_SEARCH_QUERY).toContain("profileSearch");
    expect(PROFILE_SEARCH_QUERY).toContain("searchScore");
    expect(PROFILE_SEARCH_QUERY).toContain("profileScore");
  });

  test("profile events search recipe uses generic kind-0 events", () => {
    expect(profileEventsSearchInput({ query: "calle", limit: 7 })).toEqual({
      kinds: [0],
      search: "calle",
      limit: 7,
    });
    expect(PROFILE_EVENTS_SEARCH_QUERY).toContain("events(input: $input)");
    expect(PROFILE_EVENTS_SEARCH_QUERY).toContain("content");
  });

  test("profile search schema accepts sparse nullable GraphQL profile fields", () => {
    const result = NaggProfileSearchDataSchema.safeParse({
      profileSearch: {
        query: "calle",
        limit: 2,
        sort: "globalPagerank",
        source: null,
        fromCache: true,
        nodes: [
          {
            pubkey: "5".repeat(64),
            npub: "npub1example",
            rank: 0.01,
            score: 99.1,
            searchRank: 0.01,
            searchScore: 99.1,
            profileRank: null,
            profileScore: null,
            followers: null,
            follows: null,
            createdAt: null,
            name: null,
            displayName: null,
            picture: null,
            image: null,
            banner: null,
            about: null,
            nip05: null,
            nip05Valid: null,
            website: null,
            lud16: null,
            lud06: null,
          },
        ],
        pageInfo: {
          hasNextPage: false,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test("authored reply chain input stays generic and bounded", () => {
    expect(authoredReplyChainInput({ maxBranchFanout: 32 })).toEqual({
      kinds: [1, 1111],
      via: { key: "e" },
      target: "EVENT_ID",
      maxDepth: 8,
      maxBranchFanout: 32,
    });
    expect(JSON.stringify(authoredReplyChainInput())).not.toContain(
      "sourceEventAuthor",
    );
  });

  test("relevant thread rank includes engagement, vertex, recency, and viewer boost", () => {
    const rank = threadReplyRankInput("relevant", {
      viewerPubkey: "b".repeat(64),
      shuffle: { seed: "1", counter: 2 },
    });

    expect(
      rank?.terms?.some((term) => term.pubkeyScore?.source === "vertex"),
    ).toBe(true);
    expect(
      rank?.terms?.some((term) => term.candidateField === "CREATED_AT"),
    ).toBe(true);
    expect(
      rank?.terms?.some(
        (term) => term.derivedMetric === "contribution_quality",
      ),
    ).toBe(true);
    expect(rank?.candidatePubkeyBoosts?.length).toBe(1);
    expect(rank?.shuffle?.counter).toBe(2);
  });

  test("feed recipes keep for-you and following popular distinct", () => {
    const forYou = forYouRankedEventsInput({
      viewerPubkey: "b".repeat(64),
      limit: 20,
    });
    const following = followingPopularRankedEventsInput({
      viewerPubkey: "b".repeat(64),
      limit: 20,
    });

    expect(forYou.target?.pubkeysFrom).toBeUndefined();
    expect(following.target?.pubkeysFrom).toBeDefined();
    expect(forYou.references.pubkeyScore).toEqual({ source: "vertex" });
    expect(
      forYou.terms
        ?.filter((term) => term.references)
        .every((term) => term.references?.pubkeyScore?.source === "vertex"),
    ).toBe(true);
    expect(forYou.terms?.some((term) => term.pubkeyScore)).toBe(true);
    expect(following.terms?.some((term) => term.pubkeyScore)).toBe(true);
  });

  test("feed recipes build global, recent, and following inputs", () => {
    expect(shuffleInput({ seed: "feed", counter: 1, strength: 0.15 })).toEqual({
      seed: "feed",
      counter: 1,
      strength: 0.15,
    });
    expect(followedPubkeySource("b".repeat(64))).toEqual([
      {
        latestEventTags: {
          pubkey: "b".repeat(64),
          kinds: [3],
          tag: { key: "p" },
          limit: 1,
          maxValues: 2000,
        },
      },
    ]);

    expect(
      globalTrendingRankedEventsInput({ since: 10, limit: 12, offset: 3 }),
    ).toEqual({
      references: { kinds: [7], since: 10, until: undefined },
      via: { key: "e" },
      target: { kinds: [1] },
      metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" },
      shuffle: undefined,
      limit: 12,
      offset: 3,
    });
    expect(recentNotesEventsInput({ since: 11, until: 22, limit: 13 })).toEqual(
      {
        kinds: [1, 1111],
        since: 11,
        until: 22,
        limit: 13,
      },
    );
    expect(
      followingRepliesEventsInput({ viewerPubkey: "b".repeat(64), limit: 14 }),
    ).toMatchObject({
      kinds: [1, 1111],
      tags: [{ key: "e" }],
      pubkeysFrom: followedPubkeySource("b".repeat(64)),
      limit: 14,
    });
    expect(
      followingRecentEventsInput({ viewerPubkey: "b".repeat(64), limit: 15 }),
    ).toMatchObject({
      kinds: [1, 1111],
      pubkeysFrom: followedPubkeySource("b".repeat(64)),
      limit: 15,
    });
  });

  test("feed recipes apply ignored event and pubkey exclusions", () => {
    expect(
      withEventExclusions(
        {
          kinds: [1],
          excludeIds: ["A".repeat(64)],
        },
        {
          excludeIds: ["b".repeat(64), "B".repeat(64), " "],
          excludePubkeys: ["C".repeat(64)],
        },
      ),
    ).toMatchObject({
      excludeIds: ["a".repeat(64), "b".repeat(64)],
      excludePubkeys: ["c".repeat(64)],
    });

    expect(
      withRankedTargetExclusions(
        {
          references: { kinds: [7] },
          via: { key: "e" },
          target: { kinds: [1] },
        },
        {
          excludeIds: ["d".repeat(64)],
          excludePubkeys: ["e".repeat(64)],
        },
      ),
    ).toMatchObject({
      target: {
        kinds: [1],
        excludeIds: ["d".repeat(64)],
        excludePubkeys: ["e".repeat(64)],
      },
    });
  });
});

describe("notification recipes", () => {
  test("builds strict all notifications input by default", () => {
    expect(notificationsInput({ pubkey: "a".repeat(64) })).toEqual({
      pubkey: "a".repeat(64),
      tab: "ALL",
      policy: "STRICT",
      replyScope: "THREAD",
      limit: 50,
    });
  });

  test("preserves mentions tab, relaxed policy, reply scope, and bounds", () => {
    expect(
      notificationsInput({
        pubkey: "b".repeat(64),
        tab: "MENTIONS",
        policy: "RELAXED",
        replyScope: "DIRECT",
        since: 1,
        until: 2,
        limit: 10,
      }),
    ).toEqual({
      pubkey: "b".repeat(64),
      tab: "MENTIONS",
      policy: "RELAXED",
      replyScope: "DIRECT",
      since: 1,
      until: 2,
      limit: 10,
    });
  });
});

describe("reply graph", () => {
  test("orders author chain, followed tail, ranked rest, then fallback rest", () => {
    type TestReply = ReturnType<typeof reply> & {
      childAuthorReplies?: TestReply[];
      childFollowedReplies?: TestReply[];
    };
    const authorTwo: TestReply = reply("3", "2".repeat(64));
    const followedTail: TestReply = reply("4", authorTwo.id, "b".repeat(64));
    const authorOne: TestReply = {
      ...reply("2", root.id),
      childAuthorReplies: [authorTwo],
    };
    authorTwo.childFollowedReplies = [followedTail];
    const rankedOther: TestReply = reply("5", root.id, "c".repeat(64));
    const fallbackOther: TestReply = reply("6", root.id, "d".repeat(64));

    const merged = mergeRelevantReplyNodes({
      sourceEvent: root,
      authorNodes: [authorOne],
      followedNodes: [],
      rankedNodes: [rankedOther],
      allNodes: [fallbackOther, rankedOther, authorOne],
      limit: 10,
      toEvent: (node) => node ?? undefined,
      childAuthorNodesFor: (node) => node.childAuthorReplies ?? [],
      childFollowedNodesFor: (node) => node.childFollowedReplies ?? [],
    });

    expect(merged.nodes.map((node) => node.id)).toEqual([
      authorOne.id,
      authorTwo.id,
      followedTail.id,
      rankedOther.id,
      fallbackOther.id,
    ]);
    expect(merged.authorChainIds).toEqual([authorOne.id, authorTwo.id]);
  });

  test("dmEnvelopesAppView builds the simplified REST binding (no normalize)", () => {
    const viewer = "a".repeat(64);
    const binding = dmEnvelopesAppView({ viewer, kinds: [1059], until: 1700, limit: 25 });

    expect(binding.path).toBe("/nostr/dm/envelopes");
    expect(binding.method).toBe("GET");
    expect(binding.searchParams).toEqual({
      viewer,
      kinds: "1059",
      until: 1700,
      limit: 25,
    });
    // The REST body is the canonical shape — the binding carries no normalize step.
    expect("normalize" in binding).toBe(false);
  });
});
