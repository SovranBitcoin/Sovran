import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

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
  subscribeWithSelector(
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
      persistConfig({
        name: 'mint-profile-store',
        storage: AsyncStorage,
        schema: PersistedMintProfileStore,
        logKey: 'mint_profile',
        partialize: (state) => ({ cache: state.cache }),
      })
    )
  )
);
