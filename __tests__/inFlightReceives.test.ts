import type { HistoryEntry, ReceiveOperation } from '@cashu/coco-core';
import {
  inFlightReceiveToHistoryEntry,
  isInFlightReceiveEntry,
} from '@/features/transactions/lib/inFlightReceives';

function makeExecutingReceive(overrides: Partial<ReceiveOperation> = {}): ReceiveOperation {
  return {
    id: 'op-123',
    state: 'executing',
    mintUrl: 'https://mint.example',
    unit: 'sat',
    amount: 2100,
    inputProofs: [],
    createdAt: 1700000000000,
    updatedAt: 1700000005000,
    ...overrides,
  } as unknown as ReceiveOperation;
}

describe('inFlightReceiveToHistoryEntry', () => {
  it('maps a coco executing receive op into a pending receive history entry', () => {
    const entry = inFlightReceiveToHistoryEntry(makeExecutingReceive());

    expect(entry).toMatchObject({
      id: 'receive-op-123',
      type: 'receive',
      source: 'operation',
      operationId: 'op-123',
      mintUrl: 'https://mint.example',
      unit: 'sat',
      amount: 2100,
      state: 'executing',
    });
    expect((entry as { metadata?: Record<string, string> }).metadata).toMatchObject({
      operationId: 'op-123',
      pendingReason: 'network',
    });
  });

  it('defaults a missing unit to sat', () => {
    const entry = inFlightReceiveToHistoryEntry(
      makeExecutingReceive({ unit: undefined as unknown as string })
    );
    expect(entry.unit).toBe('sat');
  });

  it('preserves the executing state so the detail screen treats it as pending', () => {
    const entry = inFlightReceiveToHistoryEntry(makeExecutingReceive());
    expect((entry as { state?: unknown }).state).toBe('executing');
  });

  it('produces an entry the bucketing predicate recognises', () => {
    const entry = inFlightReceiveToHistoryEntry(makeExecutingReceive());
    expect(isInFlightReceiveEntry(entry)).toBe(true);
  });
});

describe('isInFlightReceiveEntry', () => {
  it('is false for a finalized receive', () => {
    expect(
      isInFlightReceiveEntry({
        id: 'r1',
        type: 'receive',
        state: 'finalized',
      } as unknown as HistoryEntry)
    ).toBe(false);
  });

  it('is false for a non-receive entry even when state is executing', () => {
    expect(
      isInFlightReceiveEntry({
        id: 'm1',
        type: 'mint',
        state: 'executing',
      } as unknown as HistoryEntry)
    ).toBe(false);
  });
});
