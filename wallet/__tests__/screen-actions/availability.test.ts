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

import { describe, it, expect } from "vitest";
import {
  getAvailableActions,
  isPaymentRequestPreview,
} from "../../src/screen-actions/availability";
import { deriveMintMethodCapabilityMapFromTrustedMints } from "../../src/mint-capabilities";
import { MINT1, MINT2 } from "../_harness/fixtures";

describe("screen action availability — back", () => {
  const screens = [
    "sendToken",
    "receiveToken",
    "mintQuote",
    "meltQuote",
    "paymentRequest",
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
      effectiveSatAmount: 0,
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
      effectiveSatAmount: 1,
    };
    const actions = getAvailableActions("amountEntry", entry);
    expect(actions.next.available).toBe(true);
  });

  it("always exposes cancel as available", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      effectiveSatAmount: 0,
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

  it("hides onchain receive when no trusted mint advertises NUT-04 onchain", () => {
    const entry = {
      destination: "mintQuote",
      effectiveSatAmount: 100,
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
      effectiveSatAmount: 100,
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

  it("disables Lightning receive when no trusted mint advertises NUT-04 bolt11", () => {
    const entry = {
      destination: "mintQuote",
      effectiveSatAmount: 100,
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

  it("keeps next available when the selected receive mint advertises a higher minimum", () => {
    const entry = {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveSatAmount: 500,
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

    expect(actions.next.available).toBe(true);
    expect(actions.next.reason).toBeUndefined();
    expect(lightning).toMatchObject({ available: true });
  });

  it("keeps next available when a lower-min alternate can receive the selected below-min amount", () => {
    const entry = {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveSatAmount: 500,
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
      effectiveSatAmount: 500,
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
      effectiveSatAmount: 500,
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

    expect(actions.next.available).toBe(true);
    expect(lightning).toMatchObject({ available: true });
    expect(onchain).toMatchObject({ available: true });
  });

  it("disables Lightning send when no trusted mint advertises NUT-05 bolt11", () => {
    const entry = {
      destination: "meltQuote",
      meltTarget: "alice@example.com",
      effectiveSatAmount: 100,
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
    effectiveSatAmount: 100,
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
      effectiveSatAmount: 2500,
      methodContext: balanceContext({ [MINT1]: 1000, [MINT2]: 2000 }),
    });

    expect(actions.next.exceedsBalance).toBe(true);
    // Still available — ecash rounds the amount down to the balance.
    expect(actions.next.available).toBe(true);
  });

  it("does not flag a send amount within the largest mint balance", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      effectiveSatAmount: 2000,
      methodContext: balanceContext({ [MINT1]: 1000, [MINT2]: 2000 }),
    });

    expect(actions.next.exceedsBalance).toBe(false);
  });

  it("uses the richest mint even when a poorer mint is selected", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      selectedMintUrl: MINT1,
      effectiveSatAmount: 1500,
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
      effectiveSatAmount: 5000,
      methodContext: balanceContext({ [MINT1]: 1000, [MINT2]: 2000 }),
    });

    expect(actions.next.exceedsBalance).toBe(true);
  });

  it("never flags a receive (mintQuote) regardless of amount", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "mintQuote",
      selectedMintUrl: MINT1,
      effectiveSatAmount: 1_000_000,
      methodContext: balanceContext({ [MINT1]: 0 }),
    });

    expect(actions.next.exceedsBalance).toBe(false);
  });

  it("does not flag a zero/empty amount", () => {
    const actions = getAvailableActions("amountEntry", {
      destination: "sendEcash",
      effectiveSatAmount: 0,
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
