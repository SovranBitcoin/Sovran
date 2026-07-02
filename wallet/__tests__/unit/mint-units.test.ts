import { describe, expect, it } from "vitest";

import {
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveSupportedUnitsFromInfo,
  pickHighestBalanceUnit,
  pickMintForUnit,
  resolveReceiveMethodMint,
  SWITCHABLE_UNITS,
} from "../../src/mint-capabilities";

function mintInfo(methods: { method: string; unit: string }[]) {
  return { nuts: { "4": { methods } } };
}

describe("deriveSupportedUnitsFromInfo", () => {
  it("collects switchable units the mint advertises for minting", () => {
    const info = mintInfo([
      { method: "bolt11", unit: "sat" },
      { method: "bolt11", unit: "usd" },
      { method: "onchain", unit: "sat" },
    ]);
    expect(deriveSupportedUnitsFromInfo(info).sort()).toEqual(["sat", "usd"]);
  });

  it("ignores units outside the switchable set", () => {
    const info = mintInfo([
      { method: "bolt11", unit: "sat" },
      { method: "bolt11", unit: "chf" },
      { method: "bolt11", unit: "msat" },
    ]);
    expect(deriveSupportedUnitsFromInfo(info)).toEqual(["sat"]);
  });

  it("normalizes unit casing", () => {
    const info = mintInfo([{ method: "bolt11", unit: "USD" }]);
    expect(deriveSupportedUnitsFromInfo(info)).toEqual(["usd"]);
  });

  it("falls back to sat when metadata is missing or unparseable", () => {
    expect(deriveSupportedUnitsFromInfo(undefined)).toEqual(["sat"]);
    expect(deriveSupportedUnitsFromInfo({})).toEqual(["sat"]);
    expect(
      deriveSupportedUnitsFromInfo({ nuts: { "4": { methods: "nope" } } }),
    ).toEqual(["sat"]);
  });

  it("keeps the switcher order stable", () => {
    expect(SWITCHABLE_UNITS).toEqual(["sat", "usd", "eur", "gbp"]);
  });
});

describe("pickHighestBalanceUnit", () => {
  it("picks the supported unit with the highest balance", () => {
    expect(pickHighestBalanceUnit(["sat", "usd"], { sat: 10, usd: 500 })).toBe(
      "usd",
    );
  });

  it("tie-breaks by switcher display order (sat first)", () => {
    expect(pickHighestBalanceUnit(["usd", "sat"], { sat: 0, usd: 0 })).toBe(
      "sat",
    );
    expect(pickHighestBalanceUnit(["gbp", "eur"], {})).toBe("eur");
  });

  it("ignores balances in units the mint does not support", () => {
    expect(pickHighestBalanceUnit(["sat"], { usd: 9999, sat: 1 })).toBe("sat");
  });

  it("falls back to sat when the supported list is empty", () => {
    expect(pickHighestBalanceUnit([], { usd: 100 })).toBe("sat");
  });
});

describe("pickMintForUnit", () => {
  const mints = [
    {
      mintUrl: "https://a.mint",
      mintInfo: mintInfo([{ method: "bolt11", unit: "sat" }]),
    },
    {
      mintUrl: "https://b.mint",
      mintInfo: mintInfo([
        { method: "bolt11", unit: "sat" },
        { method: "bolt11", unit: "usd" },
      ]),
    },
    {
      mintUrl: "https://c.mint",
      mintInfo: mintInfo([{ method: "bolt11", unit: "usd" }]),
    },
  ];

  it("picks the highest-balance mint among those supporting the unit", () => {
    expect(
      pickMintForUnit(mints, "usd", {
        "https://b.mint": 5,
        "https://c.mint": 50,
      }),
    ).toBe("https://c.mint");
  });

  it("never picks a mint that does not support the unit, whatever its balance", () => {
    expect(pickMintForUnit(mints, "usd", { "https://a.mint": 9999 })).toBe(
      "https://b.mint",
    );
  });

  it("returns null when no mint supports the unit", () => {
    expect(pickMintForUnit(mints, "eur", {})).toBeNull();
    expect(pickMintForUnit([], "usd", {})).toBeNull();
  });

  it("normalizes the requested unit", () => {
    expect(pickMintForUnit(mints, " USD ", { "https://c.mint": 1 })).toBe(
      "https://c.mint",
    );
  });
});

describe("resolveReceiveMethodMint", () => {
  const BOLT11_ONLY = mintInfo([{ method: "bolt11", unit: "sat" }]);
  const WITH_BOLT12 = mintInfo([
    { method: "bolt11", unit: "sat" },
    { method: "bolt12", unit: "sat" },
  ]);
  const REQ = {
    operation: "mint" as const,
    method: "bolt12" as const,
    unit: "sat",
  };

  function ctx(mints: { mintUrl: string; mintInfo?: unknown }[]) {
    return {
      trustedMintUrls: mints.map((m) => m.mintUrl),
      mintMethodCapabilities:
        deriveMintMethodCapabilityMapFromTrustedMints(mints),
    };
  }

  it("honors an explicit pick while the mint is still trusted", () => {
    const c = ctx([
      { mintUrl: "https://a.mint", mintInfo: WITH_BOLT12 },
      { mintUrl: "https://b.mint", mintInfo: WITH_BOLT12 },
    ]);
    expect(resolveReceiveMethodMint(c, "https://b.mint", REQ)).toEqual({
      mintUrl: "https://b.mint",
      source: "explicit",
    });
  });

  it("honors an explicit pick even if the mint stopped advertising the method", () => {
    // The rail shows its unsupported state instead of silently moving the
    // user's deliberate choice.
    const c = ctx([
      { mintUrl: "https://a.mint", mintInfo: WITH_BOLT12 },
      { mintUrl: "https://b.mint", mintInfo: BOLT11_ONLY },
    ]);
    expect(resolveReceiveMethodMint(c, "https://b.mint", REQ).source).toBe(
      "explicit",
    );
  });

  it("auto-picks the first trusted mint supporting the method when unset", () => {
    const c = ctx([
      { mintUrl: "https://a.mint", mintInfo: BOLT11_ONLY },
      { mintUrl: "https://b.mint", mintInfo: WITH_BOLT12 },
      { mintUrl: "https://c.mint", mintInfo: WITH_BOLT12 },
    ]);
    expect(resolveReceiveMethodMint(c, undefined, REQ)).toEqual({
      mintUrl: "https://b.mint",
      source: "auto",
    });
  });

  it("self-heals a stale explicit pick pointing at an untrusted mint", () => {
    const c = ctx([{ mintUrl: "https://a.mint", mintInfo: WITH_BOLT12 }]);
    expect(resolveReceiveMethodMint(c, "https://gone.mint", REQ)).toEqual({
      mintUrl: "https://a.mint",
      source: "auto",
    });
  });

  it("returns none when no trusted mint supports the method", () => {
    const c = ctx([{ mintUrl: "https://a.mint", mintInfo: BOLT11_ONLY }]);
    expect(resolveReceiveMethodMint(c, undefined, REQ)).toEqual({
      mintUrl: null,
      source: "none",
    });
  });
});
