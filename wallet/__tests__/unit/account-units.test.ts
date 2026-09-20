import { describe, expect, it } from "vitest";

import {
  ACCOUNT_UNITS,
  accountUnitLabel,
  isTestnutUnit,
  toAccountUnit,
  toRealUnit,
} from "../../src/account-units";
import {
  isFiatUnit,
  majorToMinor,
  unitMinorDecimals,
  unitSymbol,
} from "../../src/formatting/units";
import {
  deriveMintMethodCapabilityMapFromTrustedMints,
  hasMintSupportingMethod,
  resolveReceiveMethodMint,
  SWITCHABLE_UNITS,
} from "../../src/mint-capabilities";

describe("account units", () => {
  it("splits a testnut mint's unit into its own account and back", () => {
    expect(toAccountUnit("usd", true)).toBe("tusd");
    expect(toAccountUnit("USD", false)).toBe("usd");
    expect(toRealUnit("tusd")).toBe("usd");
    expect(toRealUnit("usd")).toBe("usd");
    expect(isTestnutUnit("tsat")).toBe(true);
    expect(isTestnutUnit("sat")).toBe(false);
  });

  it("covers every switchable unit, real accounts first", () => {
    expect(ACCOUNT_UNITS.slice(0, SWITCHABLE_UNITS.length)).toEqual([
      ...SWITCHABLE_UNITS,
    ]);
    expect(ACCOUNT_UNITS.slice(SWITCHABLE_UNITS.length)).toEqual(
      SWITCHABLE_UNITS.map((unit) => toAccountUnit(unit, true)),
    );
  });

  it("passes an unswitchable unit through rather than inventing an account", () => {
    expect(toAccountUnit("auth", true)).toBe("auth");
    expect(isTestnutUnit("test")).toBe(false);
    expect(toRealUnit("test")).toBe("test");
  });

  it("labels accounts for tabs and badges", () => {
    expect(accountUnitLabel("sat")).toBe("BTC");
    expect(accountUnitLabel("TSAT")).toBe("tBTC");
    expect(accountUnitLabel("tusd")).toBe("tUSD");
    expect(accountUnitLabel("eur")).toBe("EUR");
  });

  it("denominates a testnut account like the unit behind it", () => {
    expect(unitSymbol("tusd")).toBe("$");
    expect(unitMinorDecimals("teur")).toBe(2);
    expect(isFiatUnit("tgbp")).toBe(true);
    expect(isFiatUnit("tsat")).toBe(false);
    expect(majorToMinor(1.5, "tusd")).toBe(150);
  });
});

describe("capability map outsideAccount", () => {
  const info = {
    nuts: {
      "4": { methods: [{ method: "onchain", unit: "usd" }] },
      "5": { methods: [{ method: "onchain", unit: "usd" }] },
    },
  };
  const REAL = "https://real.example";
  const TESTNUT = "https://testnut.example";
  const requirement = {
    operation: "mint" as const,
    method: "onchain" as const,
    unit: "usd",
  };

  // The Receive-screen bug: the only usd mint is a testnut, and a real usd
  // account must not fall through to it.
  it("never auto-picks or counts a mint from the other side of the split", () => {
    const ctx = {
      trustedMintUrls: [TESTNUT],
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
        [{ mintUrl: TESTNUT, mintInfo: info, outsideAccount: true }],
        "usd",
      ),
    };
    expect(hasMintSupportingMethod(ctx, requirement)).toBe(false);
    expect(resolveReceiveMethodMint(ctx, undefined, requirement)).toEqual({
      mintUrl: null,
      source: "none",
    });
  });

  it("still serves the mints inside the account", () => {
    const ctx = {
      trustedMintUrls: [TESTNUT, REAL],
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
        [
          { mintUrl: TESTNUT, mintInfo: info, outsideAccount: true },
          { mintUrl: REAL, mintInfo: info },
        ],
        "usd",
      ),
    };
    expect(resolveReceiveMethodMint(ctx, undefined, requirement)).toEqual({
      mintUrl: REAL,
      source: "auto",
    });
  });
});
