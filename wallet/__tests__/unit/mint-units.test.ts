import { describe, expect, it } from "vitest";

import {
  deriveSupportedUnitsFromInfo,
  pickHighestBalanceUnit,
  pickMintForUnit,
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
