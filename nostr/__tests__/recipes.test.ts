import { describe, expect, test } from "vitest";
import {
  dmEnvelopesAppView,
  followedPubkeySource,
  followingPopularRankedEventsInput,
  forYouRankedEventsInput,
  withEventExclusions,
  withRankedTargetExclusions,
} from "../src/recipes";

describe("rank recipes", () => {
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

  test("the followed-pubkey source reads the viewer's latest follow list", () => {
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

describe("appview bindings", () => {
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
