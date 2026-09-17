/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * custom-payment-methods.test.ts — NUT-04/05 methods with no NUT of their own
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NUT-04 pins `method` only to the grammar `[a-z0-9_-]+`; which methods exist
 * is entirely up to the mint, published in its NUT-06 info. Three have their
 * own spec (NUT-23 bolt11, NUT-25 bolt12, NUT-30 onchain) and coco ships
 * handlers for exactly those; anything else runs on Sovran's generic mint
 * handler and is RECEIVE ONLY.
 *
 * The fixture below is the real `GET https://mint.sortug.com/v1/info` shape,
 * trimmed: venmo is offered for usd and paypal for sat, on NUT-04 (mint) and
 * NUT-05 (melt) alike — even though that mint rejects the melt quotes in
 * practice, which is precisely why melt support must come from
 * `isMethodImplemented` and not from the advertisement.
 */

import { describe, expect, it } from "vitest";

import {
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveMintMethodSupportFromInfo,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
  isMethodImplemented,
  listCustomMintMethods,
  readAdvertisedMethodsFromInfo,
} from "../../src/mint-capabilities";
import {
  getPaymentMethodIcon,
  getPaymentMethodLabel,
  getPaymentMethodPresentation,
  isCustomPaymentMethod,
  PAYMENT_METHOD_ICONS,
  UNKNOWN_PAYMENT_METHOD_ICON,
} from "../../src/payment-methods";
import { isBuiltInMintPaymentMethod } from "../../src/types";

const SORTUG = "https://mint.sortug.com";
const PLAIN = "https://mint.example.com";

/** Trimmed from the live `mint.sortug.com` NUT-06 response. */
const SORTUG_INFO = {
  nuts: {
    "4": {
      disabled: false,
      methods: [
        { method: "bolt11", unit: "usd", min_amount: 1, max_amount: 500000 },
        { method: "onchain", unit: "usd", min_amount: 1, max_amount: 500000 },
        { method: "venmo", unit: "usd", min_amount: 1, max_amount: 500000 },
        { method: "bolt11", unit: "sat", min_amount: 1, max_amount: 500000 },
        { method: "onchain", unit: "sat", min_amount: 1, max_amount: 500000 },
        { method: "paypal", unit: "sat", min_amount: 1, max_amount: 500000 },
      ],
    },
    "5": {
      disabled: false,
      methods: [
        { method: "bolt11", unit: "sat" },
        { method: "paypal", unit: "sat" },
      ],
    },
  },
};

const PLAIN_INFO = {
  nuts: { "4": { methods: [{ method: "bolt11", unit: "sat" }] } },
};

describe("readAdvertisedMethodsFromInfo", () => {
  it("returns every NUT-04 method the mint advertises, built-in or not", () => {
    expect(readAdvertisedMethodsFromInfo(SORTUG_INFO, 4)).toEqual([
      "bolt11",
      "onchain",
      "venmo",
      "paypal",
    ]);
  });

  it("reads the NUT-05 side independently", () => {
    expect(readAdvertisedMethodsFromInfo(SORTUG_INFO, 5)).toEqual([
      "bolt11",
      "paypal",
    ]);
  });

  it("returns nothing when the NUT block is disabled", () => {
    expect(
      readAdvertisedMethodsFromInfo(
        { nuts: { "4": { disabled: true, methods: [{ method: "venmo", unit: "sat" }] } } },
        4,
      ),
    ).toEqual([]);
  });

  it("drops names that break NUT-04's [a-z0-9_-]+ grammar", () => {
    expect(
      readAdvertisedMethodsFromInfo(
        {
          nuts: {
            "4": {
              methods: [
                { method: "bank transfer", unit: "sat" },
                { method: "PAY/PAL", unit: "sat" },
                { method: "bank_transfer", unit: "sat" },
              ],
            },
          },
        },
        4,
      ),
    ).toEqual(["bank_transfer"]);
  });

  it("is empty for a mint with no info yet", () => {
    expect(readAdvertisedMethodsFromInfo(undefined, 4)).toEqual([]);
  });
});

describe("capability derivation picks up custom methods", () => {
  it("carries a row for an advertised custom method at its advertised unit", () => {
    const support = deriveMintMethodSupportFromInfo(SORTUG_INFO, "sat");

    expect(support.mint.paypal?.supported).toBe(true);
    expect(support.mint.paypal?.minAmount).toBe(1);
    expect(support.mint.paypal?.maxAmount).toBe(500000);
  });

  it("reports a custom method unsupported for a unit the mint does not pair it with", () => {
    // sortug offers venmo for usd only, so a sat wallet must not see it.
    const support = deriveMintMethodSupportFromInfo(SORTUG_INFO, "sat");

    expect(support.mint.venmo?.supported).toBe(false);
    expect(support.mint.venmo?.reason).toContain("does not support unit sat");
  });

  it("keeps the built-in rows pinned even when the mint advertises nothing unusual", () => {
    const support = deriveMintMethodSupportFromInfo(PLAIN_INFO, "sat");

    expect(Object.keys(support.mint).sort()).toEqual([
      "bolt11",
      "bolt12",
      "onchain",
    ]);
  });
});

describe("listCustomMintMethods", () => {
  const ctx = {
    trustedMintUrls: [PLAIN, SORTUG],
    mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
      [
        { mintUrl: PLAIN, mintInfo: PLAIN_INFO },
        { mintUrl: SORTUG, mintInfo: SORTUG_INFO },
      ],
      "sat",
    ),
  };

  it("lists only the non-built-in methods a trusted mint can actually serve", () => {
    expect(listCustomMintMethods(ctx, "mint", "sat")).toEqual(["paypal"]);
  });

  it("excludes methods advertised for a different unit", () => {
    // venmo is usd-only on sortug, and this capability map was built for sat.
    expect(listCustomMintMethods(ctx, "mint", "sat")).not.toContain("venmo");
  });

  it("returns nothing when no trusted mint offers anything unusual", () => {
    expect(
      listCustomMintMethods(
        {
          trustedMintUrls: [PLAIN],
          mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
            [{ mintUrl: PLAIN, mintInfo: PLAIN_INFO }],
            "sat",
          ),
        },
        "mint",
        "sat",
      ),
    ).toEqual([]);
  });
});

describe("isMethodImplemented — custom methods are receive-only", () => {
  it("allows receiving over a custom method", () => {
    expect(
      isMethodImplemented({ operation: "mint", method: "paypal", unit: "sat" }),
    ).toBe(true);
  });

  it("refuses sending over a custom method, however the mint advertises it", () => {
    // sortug lists paypal under NUT-05 and then answers
    // `/v1/melt/quote/paypal` with `50000 Invalid payment method`. There is no
    // generic melt saga, so the advertisement must not make the rail offerable.
    expect(
      isMethodImplemented({ operation: "melt", method: "paypal", unit: "sat" }),
    ).toBe(false);
  });

  it("leaves the three built-ins fully implemented on both sides", () => {
    for (const method of ["bolt11", "bolt12", "onchain"]) {
      expect(isMethodImplemented({ operation: "mint", method, unit: "sat" })).toBe(true);
      expect(isMethodImplemented({ operation: "melt", method, unit: "sat" })).toBe(true);
    }
  });

  it("explains a custom send as not-implemented rather than unsupported", () => {
    const ctx = {
      trustedMintUrls: [SORTUG],
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
        [{ mintUrl: SORTUG, mintInfo: SORTUG_INFO }],
        "sat",
      ),
    };
    const requirement = {
      operation: "melt" as const,
      method: "paypal",
      unit: "sat",
    };
    const reason = getCapabilityUnavailableReason(
      getMintMethodCapability(ctx, SORTUG, requirement),
      requirement,
    );

    expect(reason?.code).toBe("PAYMENT_METHOD_NOT_IMPLEMENTED");
    expect(reason?.message).toBe("PayPal send is not supported yet");
  });
});

describe("payment-method presentation", () => {
  it("uses the brand's own capitalisation for known methods", () => {
    expect(getPaymentMethodLabel("paypal")).toBe("PayPal");
    expect(getPaymentMethodLabel("venmo")).toBe("Venmo");
    expect(getPaymentMethodLabel("cashapp")).toBe("Cash App");
  });

  it("gives each known method a distinct glyph", () => {
    expect(getPaymentMethodIcon("paypal")).toBe("simple-icons:paypal");
    expect(getPaymentMethodIcon("venmo")).toBe("simple-icons:venmo");
  });

  it("renders a method it has never seen without a release", () => {
    const presentation = getPaymentMethodPresentation("some_new_rail");

    expect(presentation.label).toBe("Some new rail");
    expect(presentation.icon).toBe(UNKNOWN_PAYMENT_METHOD_ICON);
    expect(presentation.noun).toBe("Some new rail request");
  });

  it("matches methods case-insensitively, as NUT-04 names are lowercase", () => {
    expect(getPaymentMethodLabel("PayPal")).toBe("PayPal");
  });

  it("classifies built-ins and custom methods", () => {
    expect(isCustomPaymentMethod("bolt11")).toBe(false);
    expect(isCustomPaymentMethod("onchain")).toBe(false);
    expect(isCustomPaymentMethod("venmo")).toBe(true);
    expect(isBuiltInMintPaymentMethod("bolt12")).toBe(true);
    expect(isBuiltInMintPaymentMethod("venmo")).toBe(false);
  });

  it("declares every glyph it can return, so the icon registry can pin them", () => {
    expect(PAYMENT_METHOD_ICONS).toContain(UNKNOWN_PAYMENT_METHOD_ICON);
    expect(PAYMENT_METHOD_ICONS).toContain(getPaymentMethodIcon("paypal"));
    // No duplicates — this list is consumed as a registry checklist.
    expect(new Set(PAYMENT_METHOD_ICONS).size).toBe(PAYMENT_METHOD_ICONS.length);
  });
});
