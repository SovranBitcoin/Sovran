import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

interface CachedMintProfile {
  followers: number;
  reputation: number;
  timestamp: number;
}

interface MintProfileState {
  cache: Record<string, CachedMintProfile>;
}

interface MintProfileActions {
  getCached: (mintUrl: string) => CachedMintProfile | undefined;
  setCached: (mintUrl: string, followers: number, reputation: number) => void;
  isStale: (mintUrl: string, maxAgeMinutes?: number) => boolean;
}

type MintProfileStore = MintProfileState & MintProfileActions;

const PersistedMintProfileStore = z.object({
  cache: z
    .record(
      z.string().max(2048),
      z.looseObject({
        followers: z.number().int().nonnegative(),
        reputation: z.number(),
        timestamp: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

export const useMintProfileStore = create<MintProfileStore>()(
  persist(
    (set, get) => ({
      cache: {},

      getCached: (mintUrl: string) => {
        return get().cache[normalizeMintUrlKey(mintUrl)];
      },

      setCached: (mintUrl: string, followers: number, reputation: number) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        storeLog.debug('store.mint_profile.set_cached', {
          mintUrl: normalized,
          followers,
          reputation,
        });
        set((state) => ({
          cache: {
            ...state.cache,
            [normalized]: { followers, reputation, timestamp: Date.now() },
          },
        }));
      },

      isStale: (mintUrl: string, maxAgeMinutes: number = 30) => {
        const cached = get().cache[normalizeMintUrlKey(mintUrl)];
        if (!cached) return true;
        return (Date.now() - cached.timestamp) / (1000 * 60) > maxAgeMinutes;
      },
    }),
    {
      name: 'mint-profile-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state) => ({ cache: state.cache }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('mint_profile', PersistedMintProfileStore),
    }
  )
);
