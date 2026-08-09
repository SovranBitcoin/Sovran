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
import type { HistoryEntry } from '@cashu/coco-core';
import {
  meltOperationToScreenActionEntry,
  mergeEntryUpdate,
  shouldApplyEntryUpdate,
} from '../../src/screen-actions/createManager';
import { normalizeHistoryEntry } from '../../src/history/normalize';

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

  // Regression: coco v2 delivers `amount` as an Amount OBJECT. The mintUrl +
  // amount fallback compares by strict equality, so a raw object amount fails
  // the match and the live timeline never advances. normalizeHistoryEntry (run
  // at the bridge boundary) coerces it to a number, restoring the match.
  it('does NOT match a raw coco-v2 object amount, but DOES after normalize', () => {
    const objectAmount = makeReal({ amount: { toNumber: () => 200 } });
    expect(shouldApplyEntryUpdate(makePreview(), objectAmount)).toBe(false);
    expect(
      shouldApplyEntryUpdate(
        makePreview(),
        normalizeHistoryEntry(objectAmount as unknown as HistoryEntry) as never
      )
    ).toBe(true);
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

describe('shouldApplyEntryUpdate — preview correlation ids (BTC-08)', () => {
  // Two back-to-back same-mint same-amount operations used to cross-apply:
  // while preview #2 was open, settle events for #1 merged into it. The
  // pre-created melt quote (BTC-05) gives melt previews a unique correlation
  // id — when one exists, mintUrl+amount must NEVER be used as a fallback.

  it('melt preview with meltQuoteId matches only the update carrying that quoteId', () => {
    const preview = {
      id: 'melt-preview-1711500000000',
      type: 'melt',
      quoteId: '',
      state: 'UNPAID',
      mintUrl: MINT1,
      amount: 200,
      metadata: { phase: 'preview', meltQuoteId: 'quote-A' },
    };
    const ownUpdate = {
      id: 'op-A',
      type: 'melt',
      quoteId: 'quote-A',
      state: 'PAID',
      mintUrl: MINT1,
      amount: 200,
      metadata: { operationId: 'op-A' },
    };
    // Same mint + same amount, different quote — the BTC-08 cross-match.
    const otherUpdate = { ...ownUpdate, id: 'op-B', quoteId: 'quote-B', metadata: { operationId: 'op-B' } };

    expect(shouldApplyEntryUpdate(preview, ownUpdate)).toBe(true);
    expect(shouldApplyEntryUpdate(preview, otherUpdate)).toBe(false);
  });

  it('melt preview without a quote keeps the mintUrl + amount fallback', () => {
    const preview = {
      id: 'melt-preview-1711500000000',
      type: 'melt',
      quoteId: '',
      state: 'UNPAID',
      mintUrl: MINT1,
      amount: 200,
      metadata: { phase: 'preview', meltTarget: 'user@wallet.com' },
    };
    const update = {
      id: 'op-A',
      type: 'melt',
      quoteId: 'quote-A',
      state: 'PAID',
      mintUrl: MINT1,
      amount: 200,
    };
    expect(shouldApplyEntryUpdate(preview, update)).toBe(true);
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

// ---------------------------------------------------------------------------
// mergeEntryUpdate — phase upgrade when operationId arrives
// ---------------------------------------------------------------------------

describe('mergeEntryUpdate — phase upgrade on operationId', () => {
  it('upgrades phase from "preview" to "delivered" when operationId arrives', () => {
    const current = {
      id: 'pr-preview-123',
      type: 'send',
      mintUrl: MINT1,
      amount: 100,
      state: 'prepared',
      metadata: { paymentRequest: 'creq...', phase: 'preview' },
    };
    const updated = {
      id: 'real-id',
      type: 'send',
      mintUrl: MINT1,
      amount: 100,
      state: 'pending',
      operationId: 'op-1',
    };
    const merged = mergeEntryUpdate(current, updated);
    expect((merged.metadata as any).phase).toBe('delivered');
    expect(merged.operationId).toBe('op-1');
    expect(merged.state).toBe('pending');
  });

  it('upgrades phase when operationId is in metadata', () => {
    const current = {
      id: 'pr-preview-123',
      type: 'send',
      mintUrl: MINT1,
      amount: 100,
      metadata: { phase: 'preview' },
    };
    const updated = {
      id: 'real-id',
      type: 'send',
      mintUrl: MINT1,
      amount: 100,
      metadata: { operationId: 'op-1' },
    };
    const merged = mergeEntryUpdate(current, updated);
    expect((merged.metadata as any).phase).toBe('delivered');
  });

  it('preserves phase "preview" when no operationId', () => {
    const current = {
      id: 'pr-preview-123',
      type: 'send',
      mintUrl: MINT1,
      amount: 100,
      metadata: { phase: 'preview' },
    };
    const updated = {
      id: 'pr-preview-123',
      type: 'send',
      mintUrl: MINT1,
      amount: 100,
      state: 'prepared',
    };
    const merged = mergeEntryUpdate(current, updated);
    expect((merged.metadata as any).phase).toBe('preview');
  });

  it('does not touch phase when updated entry explicitly sets it', () => {
    const current = {
      id: 'pr-preview-123',
      type: 'send',
      metadata: { phase: 'preview' },
    };
    const updated = {
      id: 'real-id',
      type: 'send',
      operationId: 'op-1',
      metadata: { phase: 'custom-phase' },
    };
    const merged = mergeEntryUpdate(current, updated);
    expect((merged.metadata as any).phase).toBe('custom-phase');
  });

  it('preserves paymentRequest metadata through merge', () => {
    const current = {
      id: 'pr-preview-123',
      type: 'send',
      metadata: { paymentRequest: 'creq...', phase: 'preview' },
    };
    const updated = {
      id: 'real-id',
      type: 'send',
      operationId: 'op-1',
    };
    const merged = mergeEntryUpdate(current, updated);
    expect((merged.metadata as any).paymentRequest).toBe('creq...');
    expect((merged.metadata as any).phase).toBe('delivered');
  });
});

// ---------------------------------------------------------------------------
// meltOperationToScreenActionEntry — contract normalization at the adapter
// ---------------------------------------------------------------------------

describe('meltOperationToScreenActionEntry', () => {
  const baseOp = {
    id: 'melt-op-1',
    mintUrl: 'https://mint.example',
    createdAt: 1_700_000_000_000,
    quoteId: 'mq-1',
  };

  it('publishes a rolled-back melt as rolledBack, never UNPAID', () => {
    // The old private mapper fell through to "UNPAID": a live
    // melt-op:rolled-back rendered a cancelled send as "Ready to send".
    const entry = meltOperationToScreenActionEntry({
      ...baseOp,
      state: 'rolled_back',
      amount: 500,
    });
    expect(entry?.state).toBe('rolledBack');
  });

  it('downcasts a coco-v2 object Amount instead of dropping the entry', () => {
    // Returning null for object amounts was the melt twin of the history-path
    // live-update drop: the fallback publish carried no mintUrl/amount, so the
    // melt-preview match could never fire.
    const entry = meltOperationToScreenActionEntry({
      ...baseOp,
      state: 'pending',
      amount: { toNumber: () => 500 },
    });
    expect(entry).toMatchObject({
      type: 'melt',
      quoteId: 'mq-1',
      amount: 500,
      state: 'PENDING',
    });
  });

  it('maps the operation vocabulary onto the legacy contract', () => {
    const stateOf = (state: string) =>
      meltOperationToScreenActionEntry({ ...baseOp, state, amount: 1 })?.state;
    expect(stateOf('prepared')).toBe('UNPAID');
    expect(stateOf('pending')).toBe('PENDING');
    expect(stateOf('executing')).toBe('PENDING');
    expect(stateOf('finalized')).toBe('PAID');
  });

  it('still requires a quoteId and an amount', () => {
    expect(meltOperationToScreenActionEntry({ ...baseOp, quoteId: '', amount: 5 })).toBeNull();
    expect(meltOperationToScreenActionEntry({ ...baseOp, state: 'pending' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeEntryUpdate — rank guard against out-of-order live events
// ---------------------------------------------------------------------------

describe('mergeEntryUpdate — rank guard', () => {
  it('a late lower-rank mint update cannot regress a finalized entry', () => {
    const current = { id: 'e1', type: 'mint', quoteId: 'q1', state: 'ISSUED' };
    const updated = { id: 'e1', type: 'mint', quoteId: 'q1', state: 'PAID' };
    expect(mergeEntryUpdate(current, updated).state).toBe('ISSUED');
  });

  it('a forward mint update still applies', () => {
    const current = { id: 'e1', type: 'mint', quoteId: 'q1', state: 'UNPAID' };
    const updated = { id: 'e1', type: 'mint', quoteId: 'q1', state: 'ISSUED' };
    expect(mergeEntryUpdate(current, updated).state).toBe('ISSUED');
  });

  it('ranks across BOTH vocabularies (late executing after ISSUED)', () => {
    const current = { id: 'e1', type: 'mint', quoteId: 'q1', state: 'ISSUED' };
    const updated = { id: 'e1', type: 'mint', quoteId: 'q1', state: 'executing' };
    expect(mergeEntryUpdate(current, updated).state).toBe('ISSUED');
  });

  it('terminal failure always wins, even against a settled state', () => {
    const current = { id: 'e1', type: 'melt', quoteId: 'q1', state: 'PENDING' };
    const updated = { id: 'e1', type: 'melt', quoteId: 'q1', state: 'rolledBack' };
    expect(mergeEntryUpdate(current, updated).state).toBe('rolledBack');
  });

  it('a settled update can never overwrite a recorded rollback', () => {
    const current = { id: 'e1', type: 'melt', quoteId: 'q1', state: 'rolledBack' };
    const updated = { id: 'e1', type: 'melt', quoteId: 'q1', state: 'PAID' };
    expect(mergeEntryUpdate(current, updated).state).toBe('rolledBack');
  });

  it('unknown / synthetic states keep the updated-wins behavior', () => {
    const current = { id: 'e1', type: 'send', operationId: 'op-1', state: 'finalized' };
    const updated = { id: 'e1', type: 'send', operationId: 'op-1', state: 'paymentRequestPending' };
    expect(mergeEntryUpdate(current, updated).state).toBe('paymentRequestPending');
  });
});
