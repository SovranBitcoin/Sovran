/**
 * @jest-environment node
 *
 * A single corrupt basis-point value must degrade locally. The shared persist
 * merge rejects the entire blob when this schema fails, which would otherwise
 * erase every unit's mint distribution.
 */

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { TOTAL_BASIS_POINTS } from '@/shared/stores/profile/mintDistributionStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

function mintDistributionSchema() {
  const entry = persistRegistry.find((candidate) => candidate.name === 'mint-distribution-store');
  if (!entry) throw new Error('mint-distribution-store missing from persistRegistry');
  return entry.schema;
}

describe('mintDistributionStore persistence', () => {
  it('degrades one out-of-range value without rejecting the other unit distributions', () => {
    const parsed = mintDistributionSchema().parse({
      distributions: {
        sat: {
          'https://mint.valid.example': 6_000,
          'https://mint.corrupt.example': TOTAL_BASIS_POINTS + 1,
        },
        usd: {
          'https://mint.usd.example': TOTAL_BASIS_POINTS,
        },
      },
    }) as { distributions: Record<string, Record<string, number>> };

    expect(parsed.distributions).toEqual({
      sat: {
        'https://mint.valid.example': 6_000,
        'https://mint.corrupt.example': 0,
      },
      usd: {
        'https://mint.usd.example': TOTAL_BASIS_POINTS,
      },
    });
  });
});
