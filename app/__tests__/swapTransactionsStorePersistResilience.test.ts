/**
 * @jest-environment node
 *
 * Swap groups are the only local record tying a multi-leg rebalance back to
 * Coco history. Unknown enum values must degrade locally instead of making the
 * shared persist merge discard every group.
 */

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import '@/shared/stores/profile/swapTransactionsStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

function swapSchema() {
  const entry = persistRegistry.find((candidate) => candidate.name === 'swap-transactions-store');
  if (!entry) throw new Error('swap-transactions-store missing from persistRegistry');
  return entry.schema;
}

const validLeg = {
  id: 'leg-1',
  fromMintUrl: 'https://mint.one',
  toMintUrl: 'https://mint.two',
  amount: 21,
};

describe('swapTransactionsStore persistence', () => {
  it('preserves groups while degrading unknown group, leg, and quote-index enum values', () => {
    const parsed = swapSchema().parse({
      groups: {
        valid: {
          id: 'valid',
          unit: 'sat',
          createdAt: 1,
          title: 'Valid swap',
          state: 'running',
          legs: [{ ...validLeg, localStatus: 'melting' }],
        },
        future: {
          id: 'future',
          unit: 'sat',
          createdAt: 2,
          title: 'Future-version swap',
          state: 'future-terminal-state',
          legs: [{ ...validLeg, id: 'leg-2', localStatus: 'future-leg-state' }],
        },
      },
      quoteIdToGroup: {
        good: { groupId: 'valid', legId: 'leg-1', kind: 'melt' },
        future: { groupId: 'future', legId: 'leg-2', kind: 'future-quote-kind' },
      },
    }) as {
      groups: Record<string, { state: string; legs: { localStatus?: string }[] }>;
      quoteIdToGroup: Record<string, unknown>;
    };

    expect(Object.keys(parsed.groups)).toEqual(['valid', 'future']);
    expect(parsed.groups.valid).toMatchObject({
      state: 'running',
      legs: [{ localStatus: 'melting' }],
    });
    expect(parsed.groups.future).toMatchObject({
      state: 'cancelled',
      legs: [{ localStatus: 'failed' }],
    });
    expect(parsed.quoteIdToGroup).toEqual({
      good: { groupId: 'valid', legId: 'leg-1', kind: 'melt' },
    });
  });
});
