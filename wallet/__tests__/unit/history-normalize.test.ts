/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * history/normalize.ts — coco v2 → legacy read-model normalization
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * coco v2 projects history entries with operation-family states
 * (prepared/finalized/rolled_back/…) and an `amount` that is an Amount OBJECT
 * ({ toNumber() }), not a plain number. Consumers (buildTimeline, and the
 * screen-actions preview matcher `shouldApplyEntryUpdate`) speak the legacy
 * vocabulary and compare amounts by strict numeric equality. If a raw coco
 * entry reaches them un-normalized, the amount comparison silently fails and
 * live timeline updates get dropped — which is exactly the "toast fires but the
 * timeline never advances" regression these tests guard against.
 */

import { describe, it, expect } from 'vitest';

import {
  normalizeHistoryEntry,
  normalizeHistoryEntryState,
} from '../../src/history/normalize';
import type { HistoryEntry } from '@cashu/coco-core';

const meltEntry = (state: string, amount: unknown): HistoryEntry =>
  ({
    id: 'melt:abc',
    type: 'melt',
    state,
    amount,
    mintUrl: 'https://mint.example',
    unit: 'sat',
    quoteId: 'q1',
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as HistoryEntry;

describe('normalizeHistoryEntry — amount coercion', () => {
  it('coerces a coco Amount OBJECT to a plain number', () => {
    // The bug: a live coco entry carries amount as { toNumber() }. The preview
    // matcher's `ca === ua` compared 100 (number) to the object → never equal,
    // so every melt update was dropped and the timeline stuck at UNPAID.
    const entry = meltEntry('finalized', { toNumber: () => 100 });
    const normalized = normalizeHistoryEntry(entry);
    expect((normalized as { amount: unknown }).amount).toBe(100);
  });

  it('leaves an already-numeric amount as a number (and same reference)', () => {
    const entry = meltEntry('PAID', 100);
    const normalized = normalizeHistoryEntry(entry);
    expect((normalized as { amount: unknown }).amount).toBe(100);
    // Nothing changed (state already legacy, amount already numeric).
    expect(normalized).toBe(entry);
  });

  it('normalizes state AND amount together', () => {
    const entry = meltEntry('finalized', { toNumber: () => 42 });
    const normalized = normalizeHistoryEntry(entry);
    expect((normalized as { amount: unknown }).amount).toBe(42);
    // finalized melt → legacy PAID.
    expect((normalized as { state: string }).state).toBe('PAID');
  });
});

describe('normalizeHistoryEntryState — v2 → legacy vocabulary', () => {
  it('maps a rolled-back melt to the legacy rolledBack spelling', () => {
    const entry = meltEntry('rolled_back', 100);
    expect((normalizeHistoryEntryState(entry) as { state: string }).state).toBe('rolledBack');
  });

  it('maps finalized melt → PAID, prepared → UNPAID', () => {
    expect((normalizeHistoryEntryState(meltEntry('finalized', 1)) as { state: string }).state).toBe(
      'PAID'
    );
    expect((normalizeHistoryEntryState(meltEntry('prepared', 1)) as { state: string }).state).toBe(
      'UNPAID'
    );
  });
});
