/**
 * @jest-environment node
 */

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

function profileSchema() {
  const entry = persistRegistry.find((candidate) => candidate.name === 'profile-store');
  if (!entry) throw new Error('profile-store missing from persistRegistry');
  return entry.schema;
}

describe('profileStore persistence', () => {
  it('keeps the account list, active account, and migration flags when one source is unknown', () => {
    const parsed = profileSchema().parse({
      activeAccountIndex: 1,
      profiles: [
        {
          accountIndex: 0,
          pubkey: 'a'.repeat(64),
          addedAt: 1,
          source: 'derived',
          cachedBalanceSats: 21,
          cachedDisplayName: 'Primary',
        },
        {
          accountIndex: 1,
          pubkey: 'b'.repeat(64),
          addedAt: 2,
          source: 'future-source',
          cachedBalanceSats: 34,
          cachedDisplayName: 'Future profile',
        },
      ],
    }) as {
      activeAccountIndex: number;
      profiles: { source?: string; cachedBalanceSats?: number; cachedDisplayName?: string }[];
    };

    expect(parsed.activeAccountIndex).toBe(1);
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles[0]).toMatchObject({
      source: 'derived',
      cachedBalanceSats: 21,
      cachedDisplayName: 'Primary',
    });
    // Unknown custody source fails CLOSED: 'imported' routes key loading
    // through SecureStore (visible error if absent) instead of silently
    // deriving a different identity from the seed.
    expect(parsed.profiles[1]).toMatchObject({
      source: 'imported',
      cachedBalanceSats: 34,
      cachedDisplayName: 'Future profile',
    });
  });
});
