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
});
