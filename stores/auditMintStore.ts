import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuditMintResponse } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';

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

export const useAuditMintStore = create<AuditMintStore>()(
  persist(
    (set, get) => ({
      // Initial state
      cache: {},

      // Actions
      getCached: (mintUrl: string) => {
        const normalizedUrl = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl;
        const currentState = get();
        return currentState.cache[normalizedUrl];
      },

      setCached: (mintUrl: string, auditData: AuditMintResponse, mintInfo: GetInfoResponse) => {
        const normalizedUrl = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl;
        set((state) => ({
          cache: {
            ...state.cache,
            [normalizedUrl]: {
              auditData,
              mintInfo,
              timestamp: Date.now(),
            },
          },
        }));
      },

      clearCache: () => {
        set({ cache: {} });
      },

      clearMintCache: (mintUrl: string) => {
        const normalizedUrl = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl;
        set((state) => {
          const newCache = { ...state.cache };
          delete newCache[normalizedUrl];
          return { cache: newCache };
        });
      },

      isStale: (mintUrl: string, maxAgeMinutes: number = 5) => {
        const normalizedUrl = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl;
        const currentState = get();
        const cached = currentState.cache[normalizedUrl];
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
          console.error('AuditMintStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'audit-mint-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the cache data
      partialize: (state) => ({ cache: state.cache }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('AuditMintStore: Failed to rehydrate from storage:', error);
        } else {
          console.log('AuditMintStore: Successfully rehydrated from storage');
        }
      },
    }
  )
);
