/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * availability.test.ts — paymentRequestAvailability unit tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the pure availability logic that determines which actions are
 * available on each screen. Focused on paymentRequestAvailability because
 * the "Confirm" button must disappear once the payment request has been
 * delivered (i.e. operationId is present or phase is 'delivered').
 */

import { afterEach, describe, it, expect } from "vitest";
import {
  getAvailableActions,
  isPaymentRequestPreview,
} from "../../src/screen-actions/availability";
import { deriveMintMethodCapabilityMapFromTrustedMints } from "../../src/mint-capabilities";
import { setLogger } from "../../src/logger";
import { INPUTS, MINT1, MINT2 } from "../_harness/fixtures";

describe("screen action availability — back", () => {
  const screens = [
    "sendToken",
    "receiveToken",
    "mintQuote",
    "meltQuote",
    "paymentRequest",
    "receiveHub",
    "receive",
    "mintInfo",
    "amountEntry",
    "mintSelector",
  ] as const;

  it.each(screens)("%s always exposes back as available", (screen) => {
    const actions = getAvailableActions(screen, {});

    expect(actions.back.available).toBe(true);
  });
});

describe("sendTokenAvailability — copy variants", () => {
  it("surfaces emoji copy as a copy variant, not a sibling action", () => {
    const actions = getAvailableActions("sendToken", {
      token: { token: [] },
      state: "pending",
      operationId: "op-1",
    });

    expect(actions.copy.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "text", available: true }),
        expect.objectContaining({ id: "emoji", available: true }),
      ]),
    );
    expect("copyAsEmoji" in actions).toBe(false);
  });
});

describe("receiveTokenAvailability — redeem", () => {
  it("redeem is available for a scanned/pasted entry carrying metadata.rawToken", () => {
    const actions = getAvailableActions("receiveToken", {
      id: "receive-1700000000-1",
      type: "receive",
      amount: 21,
      metadata: { rawToken: "cashuBexampletoken" },
    });

    expect(actions.redeem.available).toBe(true);
  });

  it("redeem is available when the decoded token is on entry.token", () => {
    const actions = getAvailableActions("receiveToken", {
      id: "receive-1700000000-2",
      type: "receive",
      amount: 21,
      token: { mint: "https://mint1.example.com", proofs: [] },
    });

    expect(actions.redeem.available).toBe(true);
  });

  it("redeem is unavailable for a placeholder entry with no token at all", () => {
    const actions = getAvailableActions("receiveToken", {
      id: "receive-1700000000-3",
      type: "receive",
      amount: 21,
      metadata: {},
    });

    expect(actions.redeem.available).toBe(false);
  });

  it("redeem is unavailable for a finalized (already redeemed) entry", () => {
    const actions = getAvailableActions("receiveToken", {
      id: "op-finalized-123",
      type: "receive",
      amount: 21,
      metadata: { rawToken: "cashuBexampletoken" },
    });

    expect(actions.redeem.available).toBe(false);
  });

  it("redeem is unavailable for a pending recovery entry", () => {
    const actions = getAvailableActions("receiveToken", {
      id: "receive-op-123",
      type: "receive",
      amount: 21,
      state: "executing",
      metadata: { rawToken: "cashuBexampletoken", operationId: "op-123" },
    });

    expect(actions.redeem.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paymentRequest — Confirm availability
// ---------------------------------------------------------------------------

describe("paymentRequestAvailability — confirm", () => {
  it("confirm is available for a preview entry (no operationId, no phase)", () => {
    const entry = {
      id: "pr-preview-123",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      metadata: {},
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.confirm.available).toBe(true);
  });

  it('confirm is available when phase is "preview"', () => {
    const entry = {
      id: "pr-preview-123",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      metadata: { phase: "preview" },
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.confirm.available).toBe(true);
  });

  it('confirm is NOT available when phase is "delivered"', () => {
    const entry = {
      id: "op-1",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      operationId: "op-1",
      metadata: { phase: "delivered" },
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.confirm.available).toBe(false);
  });

  it("confirm is NOT available when operationId is present (even if phase is stale)", () => {
    const entry = {
      id: "op-1",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      operationId: "op-1",
      metadata: { phase: "preview" },
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.confirm.available).toBe(false);
  });

  it("confirm is NOT available when metadata.operationId is present", () => {
    const entry = {
      id: "op-1",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      metadata: { operationId: "op-1", phase: "preview" },
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.confirm.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paymentRequest — Cancel availability
// ---------------------------------------------------------------------------

describe("paymentRequestAvailability — cancel", () => {
  it("cancel is available for a preview entry", () => {
    const entry = {
      id: "pr-preview-123",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      metadata: { phase: "preview" },
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.cancel.available).toBe(true);
  });

  it("cancel is NOT available once delivered", () => {
    const entry = {
      id: "op-1",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      operationId: "op-1",
      metadata: { phase: "delivered" },
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.cancel.available).toBe(false);
  });

  it("cancel is NOT available when operationId is present", () => {
    const entry = {
      id: "op-1",
      type: "send",
      mintUrl: "https://mint1.example.com",
      amount: 100,
      operationId: "op-1",
      metadata: {},
    };
    const actions = getAvailableActions("paymentRequest", entry);
    expect(actions.cancel.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPaymentRequestPreview
// ---------------------------------------------------------------------------

describe("isPaymentRequestPreview", () => {
  it('returns true for preview entry (phase "preview", no operationId)', () => {
    const entry = {
      id: "pr-preview-123",
      type: "send",
      metadata: { phase: "preview" },
    };
    expect(isPaymentRequestPreview(entry)).toBe(true);
  });

  it("returns true when no phase and no operationId", () => {
    const entry = {
      id: "pr-preview-123",
      type: "send",
      metadata: {},
    };
    expect(isPaymentRequestPreview(entry)).toBe(true);
  });

  it("returns false when operationId is present (even with stale phase)", () => {
    const entry = {
      id: "real-id",
      type: "send",
      operationId: "op-1",
      metadata: { phase: "preview" },
    };
    expect(isPaymentRequestPreview(entry)).toBe(false);
  });

  it("returns false when metadata.operationId is present", () => {
    const entry = {
      id: "real-id",
      type: "send",
      metadata: { operationId: "op-1", phase: "preview" },
    };
    expect(isPaymentRequestPreview(entry)).toBe(false);
  });

  it('returns false when phase is "delivered"', () => {
    const entry = {
      id: "real-id",
      type: "send",
      operationId: "op-1",
      metadata: { phase: "delivered" },
    };
    expect(isPaymentRequestPreview(entry)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// amountEntry — Next gate
//
// `next.available` and the per-variant ecash/lightning availability must
// gate on the effective sat amount, not on raw numeric input. Otherwise a
// fiat-mode user typing "$0.00001" sees an enabled Next that the handler
// silently no-ops because the handler reads effectiveSatAmount.
// ---------------------------------------------------------------------------

describe("amountEntryAvailability — next gate (sat-rounded fiat input)", () => {
  it("disables next when effectiveSatAmount is 0 even if numericValue > 0", () => {
    const entry = {
      destination: "sendEcash",
      numericValue: 1e-5, // dollars in fiat mode
      effectiveAmount: { value: 0, unit: 'sat' },
    };
    const actions = getAvailableActions("amountEntry", entry);
    expect(actions.next.available).toBe(false);
    const ecash = actions.next.variants?.find((v) => v.id === "ecash");
    expect(ecash?.available).toBe(false);
  });

  it("enables next when effectiveSatAmount is at least 1 sat", () => {
    const entry = {
      destination: "sendEcash",
      numericValue: 1, // sat mode
      effectiveAmount: { value: 1, unit: 'sat' },
    };
    const actions = getAvailableActions("amountEntry", entry);
    expect(actions.next.available).toBe(true);
  });

  it("enables next at 1 minor unit on a fiat account (1 cent)", () => {
    const entry = {
      destination: "sendEcash",
      numericValue: 0.01,
      unit: "usd",
      effectiveAmount: { value: 1, unit: "usd" },
    };
    const actions = getAvailableActions("amountEntry", entry);
    expect(actions.next.available).toBe(true);
  });

  it("always exposes cancel as available", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      effectiveAmount: { value: 0, unit: 'sat' },
    });

    expect(actions.cancel.available).toBe(true);
  });

  it("exposes paste and scan on send-side amount entries only", () => {
    expect(
      getAvailableActions("amountEntry", {
        destination: "sendEcash",
      }).paste.available,
    ).toBe(true);
    expect(
      getAvailableActions("amountEntry", {
        destination: "sendEcash",
      }).scanQr.available,
    ).toBe(true);

    expect(
      getAvailableActions("amountEntry", {
        destination: "meltQuote",
      }).paste.available,
    ).toBe(true);
    expect(
      getAvailableActions("amountEntry", {
        destination: "meltQuote",
      }).scanQr.available,
    ).toBe(true);

    expect(
      getAvailableActions("amountEntry", {
        destination: "mintQuote",
      }).paste.available,
    ).toBe(false);
    expect(
      getAvailableActions("amountEntry", {
        destination: "mintQuote",
      }).scanQr.available,
    ).toBe(false);
  });

  it("hides paste and scan once a detected destination is fixed on the entry", () => {
    const entry = {
      destination: "meltQuote",
      meltTarget: "lnbc1detecteddestination",
    };
    expect(getAvailableActions("amountEntry", entry).paste.available).toBe(false);
    expect(getAvailableActions("amountEntry", entry).scanQr.available).toBe(false);
  });

  it("hides onchain receive when no trusted mint advertises NUT-04 onchain", () => {
    const entry = {
      destination: "mintQuote",
      effectiveAmount: { value: 100, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: { "4": { methods: [{ method: "bolt11", unit: "sat" }] } },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);

    expect(
      actions.next.variants?.some((variant) => variant.id === "onchain"),
    ).toBe(false);
  });

  it("shows onchain receive when a trusted mint advertises NUT-04 onchain (coco v2)", () => {
    const entry = {
      destination: "mintQuote",
      effectiveAmount: { value: 100, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 0, [MINT2]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: { "4": { methods: [{ method: "bolt11", unit: "sat" }] } },
            },
          },
          {
            mintUrl: MINT2,
            mintInfo: {
              nuts: { "4": { methods: [{ method: "onchain", unit: "sat" }] } },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);

    expect(
      actions.next.variants?.some((variant) => variant.id === "onchain"),
    ).toBe(true);
  });

  // ── Onchain SEND (NUT-30 melt) — a scanned bitcoin address ──────────────
  const BC1 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080";
  const meltCtx = (
    methods: {
      method: string;
      unit: string;
      min_amount?: number;
      max_amount?: number;
    }[],
  ) => ({
    trustedMintUrls: [MINT1],
    mintBalances: { [MINT1]: 1_000_000 },
    mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
      { mintUrl: MINT1, mintInfo: { nuts: { "5": { methods } } } },
    ]),
  });

  it("offers onchain send and NOT Lightning for a scanned bitcoin address", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "meltQuote",
      meltTarget: BC1,
      effectiveAmount: { value: 5_000, unit: "sat" },
      unit: "sat",
      methodContext: meltCtx([{ method: "onchain", unit: "sat" }]),
    });
    const onchain = actions.next.variants?.find((v) => v.id === "onchain");
    const lightning = actions.next.variants?.find((v) => v.id === "lightning");
    expect(onchain?.available).toBe(true);
    expect(onchain?.reason).toBeUndefined();
    // Bug: a bc1 address must never be "Pay <bc1…> over Lightning".
    expect(lightning?.available).toBe(false);
    expect(lightning?.description ?? "").not.toMatch(/over Lightning/i);
  });

  it('shows "No trusted mint supports onchain sending" ONLY when no mint can melt onchain', () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "meltQuote",
      meltTarget: BC1,
      effectiveAmount: { value: 5_000, unit: "sat" },
      unit: "sat",
      methodContext: meltCtx([{ method: "bolt11", unit: "sat" }]), // no onchain melt
    });
    const onchain = actions.next.variants?.find((v) => v.id === "onchain");
    expect(onchain?.available).toBe(false);
    expect(onchain?.reason).toBe("No trusted mint supports onchain sending");
  });

  it("flags a below-minimum onchain amount as a SOFT reason (neutral hint, not red)", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "meltQuote",
      meltTarget: BC1,
      effectiveAmount: { value: 500, unit: "sat" }, // below the 1,000-sat floor
      unit: "sat",
      methodContext: meltCtx([
        { method: "onchain", unit: "sat", min_amount: 1000 },
      ]),
    });
    // Next is gated, but the reason is the soft below-min code so the UI renders
    // "Minimum 1000 sat" as a neutral hint rather than a red problem.
    expect(actions.next.available).toBe(false);
    expect(actions.next.reasonCode).toBe("AMOUNT_BELOW_MINT_MIN");
  });

  it("offers Lightning (not onchain) for a bolt11 invoice target", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "meltQuote",
      meltTarget: INPUTS.bolt11WithAmount,
      effectiveAmount: { value: 250_000, unit: "sat" },
      unit: "sat",
      methodContext: meltCtx([
        { method: "bolt11", unit: "sat" },
        { method: "onchain", unit: "sat" },
      ]),
    });
    const lightning = actions.next.variants?.find((v) => v.id === "lightning");
    const onchain = actions.next.variants?.find((v) => v.id === "onchain");
    expect(lightning?.available).toBe(true);
    // A bolt11 invoice is not an onchain-send target — no onchain variant.
    expect(onchain).toBeUndefined();
  });

  it("disables Lightning receive when no trusted mint advertises NUT-04 bolt11", () => {
    const entry = {
      destination: "mintQuote",
      effectiveAmount: { value: 100, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: { "4": { methods: [{ method: "onchain", unit: "sat" }] } },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);
    const lightning = actions.next.variants?.find(
      (variant) => variant.id === "lightning",
    );

    expect(lightning).toMatchObject({
      available: false,
      reason: "No trusted mint supports Lightning receive",
    });
  });

  it("disables Lightning receive with the mint minimum when the amount is below every mint's min", () => {
    const entry = {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveAmount: { value: 500, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                "4": {
                  methods: [
                    { method: "bolt11", unit: "sat", min_amount: 1_000 },
                  ],
                },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);
    const lightning = actions.next.variants?.find(
      (variant) => variant.id === "lightning",
    );

    // 500 sat is below the only mint's advertised bolt11 minimum (1 000):
    // the rail grays out citing the bound instead of a generic reason.
    expect(lightning).toMatchObject({
      available: false,
      reason: "Minimum 1,000 sat",
    });
  });

  it("keeps next available when a lower-min alternate can receive the selected below-min amount", () => {
    const entry = {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveAmount: { value: 500, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 0, [MINT2]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                "4": {
                  methods: [
                    { method: "bolt11", unit: "sat", min_amount: 1_000 },
                  ],
                },
              },
            },
          },
          {
            mintUrl: MINT2,
            mintInfo: {
              nuts: {
                "4": {
                  methods: [{ method: "bolt11", unit: "sat", min_amount: 100 }],
                },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);
    const lightning = actions.next.variants?.find(
      (variant) => variant.id === "lightning",
    );

    expect(actions.next.available).toBe(true);
    expect(actions.next.reason).toBeUndefined();
    expect(lightning).toMatchObject({ available: true });
  });

  it("shows onchain receive regardless of advertised NUT-04 min amount (coco v2)", () => {
    const entry = {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveAmount: { value: 500, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                "4": {
                  methods: [
                    { method: "onchain", unit: "sat", min_amount: 1_000 },
                  ],
                },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);

    expect(
      actions.next.variants?.some((variant) => variant.id === "onchain"),
    ).toBe(true);
  });

  it("keeps Lightning receive available alongside advertised onchain receive (coco v2)", () => {
    const entry = {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveAmount: { value: 500, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                "4": {
                  methods: [
                    {
                      method: "bolt11",
                      unit: "sat",
                      min_amount: 1,
                      max_amount: 500_000,
                    },
                    {
                      method: "onchain",
                      unit: "sat",
                      min_amount: 1_000,
                      max_amount: 500_000,
                    },
                  ],
                },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);
    const lightning = actions.next.variants?.find(
      (variant) => variant.id === "lightning",
    );
    const onchain = actions.next.variants?.find(
      (variant) => variant.id === "onchain",
    );

    // 500 sat clears the bolt11 bounds (1..500 000) but not the onchain
    // minimum (1 000): Lightning stays the recommended live rail while
    // onchain remains visible, grayed with its minimum as the reason.
    expect(actions.next.available).toBe(true);
    expect(lightning).toMatchObject({ available: true });
    expect(onchain).toMatchObject({
      available: false,
      reason: "Minimum 1,000 sat",
    });
  });

  it("reads an onchain minimum in every AmountLike form the mint info can carry", () => {
    // cashu-ts types NUT-04 bounds as AmountLike; a bound read as "numbers
    // only" is silently dropped and onchain is offered below the minimum.
    for (const min_amount of [1_000, "1000", 1_000n, { toNumber: () => 1_000 }]) {
      const actions = getAvailableActions("amountEntry", {
        destination: "mintQuote",
        effectiveAmount: { value: 100, unit: "sat" },
        unit: "sat",
        methodContext: {
          trustedMintUrls: [MINT1],
          mintBalances: { [MINT1]: 0 },
          mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
            {
              mintUrl: MINT1,
              mintInfo: {
                nuts: {
                  "4": {
                    methods: [
                      { method: "bolt11", unit: "sat" },
                      { method: "onchain", unit: "sat", min_amount },
                    ],
                  },
                },
              },
            },
          ]),
        },
      });
      expect(
        actions.next.variants?.find((variant) => variant.id === "onchain"),
      ).toMatchObject({ available: false, reason: "Minimum 1,000 sat" });
    }
  });

  it("ignores an onchain bound that is not a safe positive integer of minor units", () => {
    // NUT-04 bounds are untrusted mint input. `Number` alone reads "0x3e8" as
    // 1000 and "1000.5" as a fractional sat; neither is a count of minor units,
    // so each must read as "no bound advertised" rather than gate the rail on a
    // number the mint did not mean.
    for (const min_amount of ["0x3e8", "1000.5", " 1e3", "1,000", Number.MAX_SAFE_INTEGER + 2]) {
      const actions = getAvailableActions("amountEntry", {
        destination: "mintQuote",
        effectiveAmount: { value: 100, unit: "sat" },
        unit: "sat",
        methodContext: {
          trustedMintUrls: [MINT1],
          mintBalances: { [MINT1]: 0 },
          mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
            {
              mintUrl: MINT1,
              mintInfo: {
                nuts: {
                  "4": {
                    methods: [
                      { method: "bolt11", unit: "sat" },
                      { method: "onchain", unit: "sat", min_amount },
                    ],
                  },
                },
              },
            },
          ]),
        },
      });
      expect(
        actions.next.variants?.find((variant) => variant.id === "onchain"),
      ).toMatchObject({ available: true });
    }
  });

  it("does not answer a sat question with a usd capability", () => {
    // The capability map is derived for ONE unit and the wallet re-derives it
    // when the active unit changes. In the window between, a `usd` map was
    // being used to answer `sat`: the menu offered a rail whose bounds and
    // support belonged to the other unit, and the picker it opened then found
    // no mint. A mismatch must read as "not known for this unit".
    const usdMap = deriveMintMethodCapabilityMapFromTrustedMints(
      [
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: {
              "4": {
                methods: [
                  { method: "bolt11", unit: "usd" },
                  { method: "onchain", unit: "usd" },
                ],
              },
            },
          },
        },
      ],
      "usd",
    );
    const actions = getAvailableActions("amountEntry", {
      destination: "mintQuote",
      effectiveAmount: { value: 100, unit: "sat" },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: usdMap,
      },
    });
    const onchain = actions.next.variants?.find(
      (variant) => variant.id === "onchain",
    );
    expect(onchain?.available ?? false).toBe(false);
  });

  it("never offers onchain receive through a mint across the testnut split", () => {
    // MINT2 is a testnut with no onchain minimum; the real account's only
    // onchain mint (MINT1) wants 1 000 sat. 100 sat must stay unavailable.
    const onchainInfo = (min_amount?: number) => ({
      nuts: {
        "4": {
          methods: [
            { method: "bolt11", unit: "sat" },
            { method: "onchain", unit: "sat", ...(min_amount ? { min_amount } : {}) },
          ],
        },
      },
    });
    const actions = getAvailableActions("amountEntry", {
      destination: "mintQuote",
      effectiveAmount: { value: 100, unit: "sat" },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 0, [MINT2]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          { mintUrl: MINT1, mintInfo: onchainInfo(1_000) },
          { mintUrl: MINT2, mintInfo: onchainInfo(), outsideAccount: true },
        ]),
      },
    });
    expect(
      actions.next.variants?.find((variant) => variant.id === "onchain"),
    ).toMatchObject({ available: false, reason: "Minimum 1,000 sat" });
  });

  it("disables Lightning send when no trusted mint advertises NUT-05 bolt11", () => {
    const entry = {
      destination: "meltQuote",
      meltTarget: "alice@example.com",
      effectiveAmount: { value: 100, unit: 'sat' },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 1000 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: { "5": { methods: [{ method: "onchain", unit: "sat" }] } },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions("amountEntry", entry);
    const lightning = actions.next.variants?.find(
      (variant) => variant.id === "lightning",
    );

    expect(lightning).toMatchObject({
      available: false,
      reason: "No trusted mint can pay over Lightning",
    });
    expect(actions.next.available).toBe(false);
  });

  it('labels the Lightning variant "to npub.cash" for npc melt targets', () => {
    // The npub.cash fallback (recipient without a lud16) must say where the
    // money actually goes; a real lud16 keeps the generic label.
    const entryFor = (meltTarget: string) => ({
      destination: "meltQuote",
      meltTarget,
      effectiveAmount: { value: 100, unit: "sat" },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 1000 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: { "5": { methods: [{ method: "bolt11", unit: "sat" }] } },
            },
          },
        ]),
      },
    });

    const labelFor = (meltTarget: string) =>
      getAvailableActions("amountEntry", entryFor(meltTarget)).next.variants?.find(
        (variant) => variant.id === "lightning",
      )?.label;

    expect(labelFor("npub1example@npubx.cash")).toBe("to npub.cash");
    expect(labelFor("npub1example@npub.cash")).toBe("to npub.cash");
    expect(labelFor("alice@example.com")).toBe("as Lightning");
  });
});

// ---------------------------------------------------------------------------
// amountEntry — exceedsBalance
//
// `next.exceedsBalance` flags a spend whose amount is larger than the spendable
// balance, independently of `next.available`. An ecash send rounds the amount
// down to the balance and so stays available, hiding the shortfall; this signal
// lets the UI surface it anyway. The ceiling is the RICHEST single mint (a
// payment draws from one mint, and the wallet can pick the fullest), never the
// currently selected mint. Receive flows have no ceiling.
// ---------------------------------------------------------------------------

describe("amountEntryAvailability — receive as Ecash (NUT-18 payment request)", () => {
  const mintQuoteEntry = (trustedMintUrls: string[]) => ({
    destination: "mintQuote",
    effectiveAmount: { value: 100, unit: 'sat' },
    unit: "sat",
    methodContext: {
      trustedMintUrls,
      mintBalances: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
        trustedMintUrls.map((mintUrl) => ({
          mintUrl,
          mintInfo: {
            nuts: { "4": { methods: [{ method: "bolt11", unit: "sat" }] } },
          },
        })),
      ),
    },
  });

  it("enables the ecash variant on receive when any trusted mint exists", () => {
    // Mints never advertise NUT-18 (wallet-to-wallet), so ANY trusted mint
    // qualifies — no capability gate.
    const actions = getAvailableActions("amountEntry", mintQuoteEntry([MINT1]));
    const ecash = actions.next.variants?.find(
      (variant) => variant.id === "ecash",
    );
    expect(ecash?.available).toBe(true);
  });

  it("disables the ecash variant when every trusted mint is across the testnut split", () => {
    // A real `sat` request must not be served by a testnut mint: both speak
    // the real unit `sat`, so only the account scope keeps them apart.
    const entry = mintQuoteEntry([MINT1]);
    entry.methodContext.mintMethodCapabilities =
      deriveMintMethodCapabilityMapFromTrustedMints([
        { mintUrl: MINT1, outsideAccount: true },
      ]);
    const actions = getAvailableActions("amountEntry", entry);
    const ecash = actions.next.variants?.find(
      (variant) => variant.id === "ecash",
    );
    expect(ecash).toMatchObject({ available: false, reason: "No trusted mints" });
  });

  it("disables the ecash variant on receive when no trusted mints exist", () => {
    const actions = getAvailableActions("amountEntry", mintQuoteEntry([]));
    const ecash = actions.next.variants?.find(
      (variant) => variant.id === "ecash",
    );
    expect(ecash?.available ?? false).toBe(false);
  });
});

describe("amountEntryAvailability — exceedsBalance", () => {
  const balanceContext = (balances: Record<string, number>) => ({
    trustedMintUrls: Object.keys(balances),
    mintBalances: balances,
  });

  it("flags a send amount above the largest mint balance", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      effectiveAmount: { value: 2500, unit: 'sat' },
      methodContext: balanceContext({ [MINT1]: 1000, [MINT2]: 2000 }),
    });

    expect(actions.next.exceedsBalance).toBe(true);
    // Still available — ecash rounds the amount down to the balance.
    expect(actions.next.available).toBe(true);
  });

  it("does not flag a send amount within the largest mint balance", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      effectiveAmount: { value: 2000, unit: 'sat' },
      methodContext: balanceContext({ [MINT1]: 1000, [MINT2]: 2000 }),
    });

    expect(actions.next.exceedsBalance).toBe(false);
  });

  it("uses the richest mint even when a poorer mint is selected", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      selectedMintUrl: MINT1,
      effectiveAmount: { value: 1500, unit: 'sat' },
      methodContext: balanceContext({ [MINT1]: 1000, [MINT2]: 2000 }),
    });

    // 1500 exceeds the selected MINT1 (1000) but fits inside MINT2 (2000),
    // the best single-mint send — so it is NOT over balance.
    expect(actions.next.exceedsBalance).toBe(false);
  });

  it("flags a melt (lightning) send above every mint", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "meltQuote",
      selectedMintUrl: MINT1,
      effectiveAmount: { value: 5000, unit: 'sat' },
      methodContext: balanceContext({ [MINT1]: 1000, [MINT2]: 2000 }),
    });

    expect(actions.next.exceedsBalance).toBe(true);
  });

  it("never flags a receive (mintQuote) regardless of amount", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveAmount: { value: 1_000_000, unit: 'sat' },
      methodContext: balanceContext({ [MINT1]: 0 }),
    });

    expect(actions.next.exceedsBalance).toBe(false);
  });

  it("does not flag a zero/empty amount", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      effectiveAmount: { value: 0, unit: 'sat' },
      methodContext: balanceContext({ [MINT1]: 0, [MINT2]: 0 }),
    });

    expect(actions.next.exceedsBalance).toBe(false);
  });
});

describe("mintSelectorAvailability", () => {
  it("always exposes cancel as available", () => {
    const actions = getAvailableActions("mintSelector", {
      items: [],
      destination: "sendEcash",
    });

    expect(actions.cancel.available).toBe(true);
  });
});

describe("receiveHubAvailability", () => {
  const hubEntry = (mintInfoNuts: Record<string, unknown>) => ({
    type: "receive",
    id: "receive-hub",
    unit: "sat",
    methodContext: {
      trustedMintUrls: [MINT1],
      mintBalances: { [MINT1]: 0 },
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        { mintUrl: MINT1, mintInfo: { nuts: mintInfoNuts } },
      ]),
    },
  });

  it("exposes all four options when a bolt11 mint exists", () => {
    const actions = getAvailableActions(
      "receiveHub",
      hubEntry({ "4": { methods: [{ method: "bolt11", unit: "sat" }] } }),
    );

    expect(actions.qrDisplay.available).toBe(true);
    expect(actions.scanQr.available).toBe(true);
    expect(actions.paste.available).toBe(true);
    expect(actions.fixedAmount.available).toBe(true);
  });

  it("disables fixedAmount (with reason) when no mint supports bolt11", () => {
    const actions = getAvailableActions(
      "receiveHub",
      hubEntry({ "4": { methods: [{ method: "onchain", unit: "sat" }] } }),
    );

    expect(actions.fixedAmount.available).toBe(false);
    expect(actions.fixedAmount.reason).toMatch(/Lightning/);
    expect(actions.qrDisplay.available).toBe(true);
  });

  it("gates every option except back until the hub entry loads", () => {
    const actions = getAvailableActions("receiveHub", {});

    expect(actions.qrDisplay.available).toBe(false);
    expect(actions.scanQr.available).toBe(false);
    expect(actions.paste.available).toBe(false);
    expect(actions.fixedAmount.available).toBe(false);
    expect(actions.back.available).toBe(true);
  });
});

describe("amountEntry — the log explains each Next method", () => {
  afterEach(() => setLogger(null));

  const methodLogs = (entry: Record<string, unknown>) => {
    const logs: Record<string, unknown>[] = [];
    const record = (event: string, fields?: Record<string, unknown>) => {
      if (event.startsWith("screenActions.availability.amountEntry.method.")) {
        logs.push(fields ?? {});
      }
    };
    setLogger({ debug: record, info: record, warn: record, error: record });
    getAvailableActions("amountEntry", entry);
    return Object.fromEntries(logs.map((log) => [log.id, log]));
  };

  it("names the rule, its operands and each mint's verdict for a disabled method", () => {
    const logs = methodLogs({
      destination: "mintQuote",
      effectiveAmount: { value: 500, unit: "sat" },
      unit: "sat",
      methodContext: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 0, [MINT2]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: { "4": { methods: [{ method: "bolt11", unit: "sat", min_amount: 1_000 }] } },
            },
          },
          { mintUrl: MINT2, mintInfo: { nuts: { "4": { methods: [] } } } },
        ]),
      },
    });

    expect(logs.lightning).toMatchObject({
      flow: "mintQuote",
      shown: true,
      available: false,
      rule: "nextCanFire && receiveLightningCompatible",
      conditions: { nextCanFire: true, receiveLightningCompatible: false },
    });
    const mints = logs.lightning?.mints as Record<string, string>;
    // The mint that merely lacks the method sorts after the one the amount rules out.
    expect(Object.keys(mints)).toEqual([MINT1, MINT2]);
    expect(mints[MINT1]).toMatch(/^AMOUNT_BELOW_MINT_MIN: .*1,000/);
    expect(mints[MINT2]).toMatch(/^MINT_METHOD_UNSUPPORTED/);
    expect(logs.ecash).toMatchObject({
      available: true,
      rule: "nextCanFire && hasAccountMint",
      conditions: { hasAccountMint: true },
    });
    expect(logs.onchain).toMatchObject({ shown: false, available: false });
    expect(String(logs.onchain?.rule)).toMatch(/^hidden:/);
  });

  it("says why Lightning is never offered for a bitcoin address", () => {
    const logs = methodLogs({
      destination: "meltQuote",
      meltTarget: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
      effectiveAmount: { value: 5_000, unit: "sat" },
      unit: "sat",
    });

    expect(logs.lightning).toMatchObject({
      available: false,
      rule: "never: the melt target is a bitcoin address",
      mints: null,
    });
    expect(logs.onchain).toMatchObject({
      shown: true,
      rule: "nextCanFire && sendOnchainSupported && sendOnchainCompatible",
    });
  });
});
