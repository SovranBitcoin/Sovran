import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';

import type { MintRecommendation } from '@/shared/lib/apiClient';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { clearPersistedStore } from '@/shared/lib/persist/clearPersistedStore';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

interface CachedKYMData {
  score: number;
  recommendations: MintRecommendation[];
  timestamp: number;
}

interface KYMMintState {
  cache: Record<string, CachedKYMData>;
}

interface KYMMintActions {
  getCached: (mintUrl: string) => CachedKYMData | undefined;
  setCached: (mintUrl: string, score: number, recommendations: MintRecommendation[]) => void;
  clearCache: () => void;
  clearMintCache: (mintUrl: string) => void;
  isStale: (mintUrl: string, maxAgeMinutes?: number) => boolean;
  clearAllData: () => Promise<void>;
}

type KYMMintStore = KYMMintState & KYMMintActions;

const PersistedKymMintStore = z.object({
  cache: z
    .record(
      z.string().max(2048),
      z.looseObject({
        score: z.number(),
        recommendations: z.array(z.unknown()).max(1024),
        timestamp: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

export const useKYMMintStore = create<KYMMintStore>()(
  persist(
    (set, get) => ({
      // Initial state
      cache: {},

      // Actions
      getCached: (mintUrl: string) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        const currentState = get();
        return currentState.cache[normalized];
      },

      setCached: (mintUrl: string, score: number, recommendations: MintRecommendation[]) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        storeLog.debug('store.kym_mint.set_cached', {
          mintUrl: normalized,
          score,
          recommendationCount: recommendations.length,
        });
        set((state) => ({
          cache: {
            ...state.cache,
            [normalized]: {
              score,
              recommendations,
              timestamp: Date.now(),
            },
          },
        }));
      },

      clearCache: () => {
        storeLog.info('store.kym_mint.clear_cache');
        set({ cache: {} });
      },

      clearMintCache: (mintUrl: string) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        storeLog.debug('store.kym_mint.clear_mint_cache', { mintUrl: normalized });
        set((state) => {
          const newCache = { ...state.cache };
          delete newCache[normalized];
          return { cache: newCache };
        });
      },

      isStale: (mintUrl: string, maxAgeMinutes: number = 60) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        const currentState = get();
        const cached = currentState.cache[normalized];
        if (!cached) return true;

        const ageMinutes = (Date.now() - cached.timestamp) / (1000 * 60);
        return ageMinutes > maxAgeMinutes;
      },

      clearAllData: async () => {
        try {
          await clearPersistedStore(useKYMMintStore, { cache: {} });
        } catch (error) {
          storeLog.error('store.kym_mint.clear_failed', { error: redactError(error) });
          throw error;
        }
      },
    }),
    {
      name: 'kym-mint-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // Only persist the cache data
      partialize: (state) => ({ cache: state.cache }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('kym_mint', PersistedKymMintStore),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          storeLog.warn('store.kym_mint.rehydrate_failed', { error: redactError(error) });
        }
      },
    }
  )
);
