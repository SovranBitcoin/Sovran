/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * entry-matching.test.ts — shouldApplyEntryUpdate unit tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the entry matching logic that determines whether an incoming
 * history/operation update should replace the current screen entry.
 *
 * Melt preview entries are a special case: the MeltQuoteScreen opens with
 * a preview entry (id 'melt-preview-...', no quoteId) before the real
 * operation starts. When melt-op events fire, the update must match the
 * preview entry by mintUrl + amount since there's no common ID yet.
 */

import { describe, it, expect } from 'vitest';
import { shouldApplyEntryUpdate } from '../../src/screen-actions/createManager';

const MINT1 = 'https://mint1.example.com';
const MINT2 = 'https://mint2.example.com';

// ---------------------------------------------------------------------------
// Melt — quoteId and operationId matching (existing behavior)
// ---------------------------------------------------------------------------

describe('shouldApplyEntryUpdate — melt identity matching', () => {
  it('matches by quoteId when both are present', () => {
    const current = { type: 'melt', id: 'a', quoteId: 'q-1', mintUrl: MINT1, amount: 200 };
    const updated = { type: 'melt', id: 'b', quoteId: 'q-1', mintUrl: MINT1, amount: 200 };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(true);
  });

  it('matches by operationId in metadata', () => {
    const current = {
      type: 'melt',
      id: 'op-1',
      quoteId: 'q-1',
      mintUrl: MINT1,
      amount: 200,
      metadata: { operationId: 'op-1' },
    };
    const updated = {
      type: 'melt',
      id: 'op-1',
      quoteId: 'q-2',
      mintUrl: MINT1,
      amount: 200,
      metadata: { operationId: 'op-1' },
    };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(true);
  });

  it('rejects different types', () => {
    const current = { type: 'melt', id: 'a', quoteId: 'q-1', mintUrl: MINT1, amount: 200 };
    const updated = { type: 'send', id: 'a', mintUrl: MINT1, amount: 200 };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Melt — preview entry matching (new behavior)
// ---------------------------------------------------------------------------

describe('shouldApplyEntryUpdate — melt preview fallback', () => {
  const makePreview = (overrides?: Record<string, unknown>) => ({
    id: 'melt-preview-1711500000000',
    type: 'melt',
    quoteId: '',
    state: 'UNPAID',
    mintUrl: MINT1,
    amount: 200,
    metadata: { phase: 'preview', meltTarget: 'user@wallet.com' },
    ...overrides,
  });

  const makeReal = (overrides?: Record<string, unknown>) => ({
    id: 'operation-uuid',
    type: 'melt',
    quoteId: 'real-quote-id',
    state: 'PAID',
    mintUrl: MINT1,
    amount: 200,
    metadata: { operationId: 'operation-uuid' },
    ...overrides,
  });

  it('matches preview to real entry by mintUrl + amount', () => {
    expect(shouldApplyEntryUpdate(makePreview(), makeReal())).toBe(true);
  });

  it('matches preview to pending entry', () => {
    expect(shouldApplyEntryUpdate(makePreview(), makeReal({ state: 'PENDING' }))).toBe(true);
  });

  it('does NOT match preview with different mintUrl', () => {
    expect(shouldApplyEntryUpdate(makePreview(), makeReal({ mintUrl: MINT2 }))).toBe(false);
  });

  it('does NOT match preview with different amount', () => {
    expect(shouldApplyEntryUpdate(makePreview(), makeReal({ amount: 300 }))).toBe(false);
  });

  it('does NOT match non-preview entries by mintUrl + amount alone', () => {
    const current = {
      id: 'some-real-id',
      type: 'melt',
      quoteId: 'q-1',
      mintUrl: MINT1,
      amount: 200,
    };
    const updated = {
      id: 'different-id',
      type: 'melt',
      quoteId: 'q-2',
      mintUrl: MINT1,
      amount: 200,
    };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(false);
  });

  it('rejects null current entry', () => {
    expect(shouldApplyEntryUpdate(null, makeReal())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Send — operationId matching (existing behavior)
// ---------------------------------------------------------------------------

describe('shouldApplyEntryUpdate — send identity matching', () => {
  it('matches by operationId when both are present', () => {
    const current = {
      type: 'send',
      id: 'a',
      operationId: 'op-1',
      mintUrl: MINT1,
      amount: 100,
    };
    const updated = {
      type: 'send',
      id: 'b',
      operationId: 'op-1',
      mintUrl: MINT1,
      amount: 100,
    };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(true);
  });

  it('matches by operationId in metadata', () => {
    const current = {
      type: 'send',
      id: 'a',
      mintUrl: MINT1,
      amount: 100,
      metadata: { operationId: 'op-1' },
    };
    const updated = {
      type: 'send',
      id: 'b',
      mintUrl: MINT1,
      amount: 100,
      metadata: { operationId: 'op-1' },
    };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(true);
  });

  it('rejects different operationIds', () => {
    const current = {
      type: 'send',
      id: 'a',
      operationId: 'op-1',
      mintUrl: MINT1,
      amount: 100,
    };
    const updated = {
      type: 'send',
      id: 'b',
      operationId: 'op-2',
      mintUrl: MINT1,
      amount: 100,
    };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Send — preview entry matching (payment request preview)
// ---------------------------------------------------------------------------

describe('shouldApplyEntryUpdate — send preview fallback', () => {
  const makePreview = (overrides?: Record<string, unknown>) => ({
    id: 'pr-preview-1711500000000',
    type: 'send',
    mintUrl: MINT1,
    amount: 100,
    metadata: { paymentRequest: 'creq...', phase: 'preview' },
    ...overrides,
  });

  const makeReal = (overrides?: Record<string, unknown>) => ({
    id: 'operation-uuid',
    type: 'send',
    operationId: 'operation-uuid',
    mintUrl: MINT1,
    amount: 100,
    ...overrides,
  });

  it('matches preview to real entry by mintUrl + amount', () => {
    expect(shouldApplyEntryUpdate(makePreview(), makeReal())).toBe(true);
  });

  it('does NOT match preview with different mintUrl', () => {
    expect(shouldApplyEntryUpdate(makePreview(), makeReal({ mintUrl: MINT2 }))).toBe(false);
  });

  it('does NOT match preview with different amount', () => {
    expect(shouldApplyEntryUpdate(makePreview(), makeReal({ amount: 300 }))).toBe(false);
  });

  it('does NOT match non-preview send entries by mintUrl + amount alone', () => {
    const current = {
      id: 'some-real-id',
      type: 'send',
      operationId: 'op-1',
      mintUrl: MINT1,
      amount: 100,
    };
    const updated = {
      id: 'different-id',
      type: 'send',
      operationId: 'op-2',
      mintUrl: MINT1,
      amount: 100,
    };
    expect(shouldApplyEntryUpdate(current, updated)).toBe(false);
  });
});
