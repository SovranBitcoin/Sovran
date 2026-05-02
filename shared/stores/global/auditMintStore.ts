import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { log, storeLog } from '@/shared/lib/logger';

import type { AuditMintResponse } from '@/shared/lib/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

interface CachedMintData {
  auditData: AuditMintResponse;
  mintInfo: GetInfoResponse;
  timestamp: number;
}

interface AuditMintState {
  cache: Record<string, CachedMintData>;
}

interface AuditMintActions {
  getCached: (mintUrl: string) => CachedMintData | undefined;
  setCached: (mintUrl: string, auditData: AuditMintResponse, mintInfo: GetInfoResponse) => void;
  clearCache: () => void;
  clearMintCache: (mintUrl: string) => void;
  isStale: (mintUrl: string, maxAgeMinutes?: number) => boolean;
  clearAllData: () => Promise<void>;
}

type AuditMintStore = AuditMintState & AuditMintActions;

// Envelope-only validation: `auditData` and `mintInfo` are upstream API
// shapes whose strict definition lives outside this store; treat them as
// `unknown` on rehydrate and let the consumers re-fetch on cache miss.
const PersistedAuditMintStore = z.object({
  cache: z
    .record(
      z.string().max(2048),
      z.looseObject({
        auditData: z.unknown(),
        mintInfo: z.unknown(),
        timestamp: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

export const useAuditMintStore = create<AuditMintStore>()(
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

      setCached: (mintUrl: string, auditData: AuditMintResponse, mintInfo: GetInfoResponse) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        storeLog.debug('store.audit_mint.set_cached', { mintUrl: normalized });
        set((state) => ({
          cache: {
            ...state.cache,
            [normalized]: {
              auditData,
              mintInfo,
              timestamp: Date.now(),
            },
          },
        }));
      },

      clearCache: () => {
        storeLog.info('store.audit_mint.clear_cache');
        set({ cache: {} });
      },

      clearMintCache: (mintUrl: string) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        storeLog.debug('store.audit_mint.clear_mint_cache', { mintUrl: normalized });
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

      // Clear all data from both state and storage
      clearAllData: async () => {
        try {
          await AsyncStorage.removeItem('audit-mint-store');
          set({ cache: {} });
        } catch (error) {
          log.error('store.audit_mint.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'audit-mint-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // Only persist the cache data
      partialize: (state) => ({ cache: state.cache }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('audit_mint', PersistedAuditMintStore),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          log.warn('store.audit_mint.rehydrate_failed', { error });
        }
      },
    }
  )
);
