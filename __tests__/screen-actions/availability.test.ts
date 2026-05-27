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

import { describe, it, expect } from 'vitest';
import {
  getAvailableActions,
  isPaymentRequestPreview,
} from '../../src/screen-actions/availability';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import { MINT1, MINT2 } from '../_harness/fixtures';

// ---------------------------------------------------------------------------
// paymentRequest — Confirm availability
// ---------------------------------------------------------------------------

describe('paymentRequestAvailability — confirm', () => {
  it('confirm is available for a preview entry (no operationId, no phase)', () => {
    const entry = {
      id: 'pr-preview-123',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      metadata: {},
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.confirm.available).toBe(true);
  });

  it('confirm is available when phase is "preview"', () => {
    const entry = {
      id: 'pr-preview-123',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      metadata: { phase: 'preview' },
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.confirm.available).toBe(true);
  });

  it('confirm is NOT available when phase is "delivered"', () => {
    const entry = {
      id: 'op-1',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      operationId: 'op-1',
      metadata: { phase: 'delivered' },
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.confirm.available).toBe(false);
  });

  it('confirm is NOT available when operationId is present (even if phase is stale)', () => {
    const entry = {
      id: 'op-1',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      operationId: 'op-1',
      metadata: { phase: 'preview' },
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.confirm.available).toBe(false);
  });

  it('confirm is NOT available when metadata.operationId is present', () => {
    const entry = {
      id: 'op-1',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      metadata: { operationId: 'op-1', phase: 'preview' },
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.confirm.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paymentRequest — Cancel availability
// ---------------------------------------------------------------------------

describe('paymentRequestAvailability — cancel', () => {
  it('cancel is available for a preview entry', () => {
    const entry = {
      id: 'pr-preview-123',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      metadata: { phase: 'preview' },
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.cancel.available).toBe(true);
  });

  it('cancel is NOT available once delivered', () => {
    const entry = {
      id: 'op-1',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      operationId: 'op-1',
      metadata: { phase: 'delivered' },
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.cancel.available).toBe(false);
  });

  it('cancel is NOT available when operationId is present', () => {
    const entry = {
      id: 'op-1',
      type: 'send',
      mintUrl: 'https://mint1.example.com',
      amount: 100,
      operationId: 'op-1',
      metadata: {},
    };
    const actions = getAvailableActions('paymentRequest', entry);
    expect(actions.cancel.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPaymentRequestPreview
// ---------------------------------------------------------------------------

describe('isPaymentRequestPreview', () => {
  it('returns true for preview entry (phase "preview", no operationId)', () => {
    const entry = {
      id: 'pr-preview-123',
      type: 'send',
      metadata: { phase: 'preview' },
    };
    expect(isPaymentRequestPreview(entry)).toBe(true);
  });

  it('returns true when no phase and no operationId', () => {
    const entry = {
      id: 'pr-preview-123',
      type: 'send',
      metadata: {},
    };
    expect(isPaymentRequestPreview(entry)).toBe(true);
  });

  it('returns false when operationId is present (even with stale phase)', () => {
    const entry = {
      id: 'real-id',
      type: 'send',
      operationId: 'op-1',
      metadata: { phase: 'preview' },
    };
    expect(isPaymentRequestPreview(entry)).toBe(false);
  });

  it('returns false when metadata.operationId is present', () => {
    const entry = {
      id: 'real-id',
      type: 'send',
      metadata: { operationId: 'op-1', phase: 'preview' },
    };
    expect(isPaymentRequestPreview(entry)).toBe(false);
  });

  it('returns false when phase is "delivered"', () => {
    const entry = {
      id: 'real-id',
      type: 'send',
      operationId: 'op-1',
      metadata: { phase: 'delivered' },
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

describe('amountEntryAvailability — next gate (sat-rounded fiat input)', () => {
  it('disables next when effectiveSatAmount is 0 even if numericValue > 0', () => {
    const entry = {
      destination: 'sendEcash',
      numericValue: 1e-5, // dollars in fiat mode
      effectiveSatAmount: 0,
    };
    const actions = getAvailableActions('amountEntry', entry);
    expect(actions.next.available).toBe(false);
    const ecash = actions.next.variants?.find((v) => v.id === 'ecash');
    expect(ecash?.available).toBe(false);
  });

  it('enables next when effectiveSatAmount is at least 1 sat', () => {
    const entry = {
      destination: 'sendEcash',
      numericValue: 1, // sat mode
      effectiveSatAmount: 1,
    };
    const actions = getAvailableActions('amountEntry', entry);
    expect(actions.next.available).toBe(true);
  });

  it('hides onchain receive when no trusted mint advertises NUT-04 onchain', () => {
    const entry = {
      destination: 'mintQuote',
      effectiveSatAmount: 100,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } } },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);

    expect(actions.next.variants?.some((variant) => variant.id === 'onchain')).toBe(false);
  });

  it('hides onchain receive even when a trusted mint advertises NUT-04 onchain', () => {
    const entry = {
      destination: 'mintQuote',
      effectiveSatAmount: 100,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 0, [MINT2]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } } },
          },
          {
            mintUrl: MINT2,
            mintInfo: { nuts: { '4': { methods: [{ method: 'onchain', unit: 'sat' }] } } },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);

    expect(actions.next.variants?.some((variant) => variant.id === 'onchain')).toBe(false);
  });

  it('disables Lightning receive when no trusted mint advertises NUT-04 bolt11', () => {
    const entry = {
      destination: 'mintQuote',
      effectiveSatAmount: 100,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: { nuts: { '4': { methods: [{ method: 'onchain', unit: 'sat' }] } } },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);
    const lightning = actions.next.variants?.find((variant) => variant.id === 'lightning');

    expect(lightning).toMatchObject({
      available: false,
      reason: 'No trusted mint supports Lightning receive',
    });
  });

  it('keeps next available when the selected receive mint advertises a higher minimum', () => {
    const entry = {
      destination: 'mintQuote',
      selectedMintUrl: MINT1,
      effectiveSatAmount: 500,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                '4': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1_000 }] },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);
    const lightning = actions.next.variants?.find((variant) => variant.id === 'lightning');

    expect(actions.next.available).toBe(true);
    expect(actions.next.reason).toBeUndefined();
    expect(lightning).toMatchObject({ available: true });
  });

  it('keeps next available when a lower-min alternate can receive the selected below-min amount', () => {
    const entry = {
      destination: 'mintQuote',
      selectedMintUrl: MINT1,
      effectiveSatAmount: 500,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 0, [MINT2]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                '4': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1_000 }] },
              },
            },
          },
          {
            mintUrl: MINT2,
            mintInfo: {
              nuts: {
                '4': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 100 }] },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);
    const lightning = actions.next.variants?.find((variant) => variant.id === 'lightning');

    expect(actions.next.available).toBe(true);
    expect(actions.next.reason).toBeUndefined();
    expect(lightning).toMatchObject({ available: true });
  });

  it('hides onchain receive regardless of advertised NUT-04 min amount', () => {
    const entry = {
      destination: 'mintQuote',
      selectedMintUrl: MINT1,
      effectiveSatAmount: 500,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                '4': { methods: [{ method: 'onchain', unit: 'sat', min_amount: 1_000 }] },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);

    expect(actions.next.variants?.some((variant) => variant.id === 'onchain')).toBe(false);
  });

  it('keeps Lightning receive available and hides unsupported onchain receive', () => {
    const entry = {
      destination: 'mintQuote',
      selectedMintUrl: MINT1,
      effectiveSatAmount: 500,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 0 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                '4': {
                  methods: [
                    { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500_000 },
                    { method: 'onchain', unit: 'sat', min_amount: 1_000, max_amount: 500_000 },
                  ],
                },
              },
            },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);
    const lightning = actions.next.variants?.find((variant) => variant.id === 'lightning');
    const onchain = actions.next.variants?.find((variant) => variant.id === 'onchain');

    expect(actions.next.available).toBe(true);
    expect(lightning).toMatchObject({ available: true });
    expect(onchain).toBeUndefined();
  });

  it('disables Lightning send when no trusted mint advertises NUT-05 bolt11', () => {
    const entry = {
      destination: 'meltQuote',
      meltTarget: 'alice@example.com',
      effectiveSatAmount: 100,
      unit: 'sat',
      methodContext: {
        trustedMintUrls: [MINT1],
        mintBalances: { [MINT1]: 1000 },
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: { nuts: { '5': { methods: [{ method: 'onchain', unit: 'sat' }] } } },
          },
        ]),
      },
    };

    const actions = getAvailableActions('amountEntry', entry);
    const lightning = actions.next.variants?.find((variant) => variant.id === 'lightning');

    expect(lightning).toMatchObject({
      available: false,
      reason: 'No trusted mint can pay over Lightning',
    });
    expect(actions.next.available).toBe(false);
  });
});
