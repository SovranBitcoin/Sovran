import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MintRecommendation } from 'hooks/coco/useKYMMints';

// Consistent URL normalization across the app
// Only lowercases the domain, preserves path case (e.g., /Bitcoin stays /Bitcoin)
const normalizeUrl = (url: string): string => {
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    // No path, just domain
    return withoutProtocol
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }
  const domain = withoutProtocol
    .slice(0, slashIndex)
    .toLowerCase()
    .replace(/^www\./, '');
  const path = withoutProtocol.slice(slashIndex).replace(/\/$/, '');
  return domain + path;
};

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

export const useKYMMintStore = create<KYMMintStore>()(
  persist(
    (set, get) => ({
      // Initial state
      cache: {},

      // Actions
      getCached: (mintUrl: string) => {
        const normalized = normalizeUrl(mintUrl);
        const currentState = get();
        return currentState.cache[normalized];
      },

      setCached: (mintUrl: string, score: number, recommendations: MintRecommendation[]) => {
        const normalized = normalizeUrl(mintUrl);
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
        set({ cache: {} });
      },

      clearMintCache: (mintUrl: string) => {
        const normalized = normalizeUrl(mintUrl);
        set((state) => {
          const newCache = { ...state.cache };
          delete newCache[normalized];
          return { cache: newCache };
        });
      },

      isStale: (mintUrl: string, maxAgeMinutes: number = 5) => {
        const normalized = normalizeUrl(mintUrl);
        const currentState = get();
        const cached = currentState.cache[normalized];
        if (!cached) return true;

        const ageMinutes = (Date.now() - cached.timestamp) / (1000 * 60);
        return ageMinutes > maxAgeMinutes;
      },

      // Clear all data from both state and storage
      clearAllData: async () => {
        try {
          await AsyncStorage.removeItem('kym-mint-store');
          set({ cache: {} });
        } catch (error) {
          console.error('KYMMintStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'kym-mint-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the cache data
      partialize: (state) => ({ cache: state.cache }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('KYMMintStore: Failed to rehydrate from storage:', error);
        } else {
          console.log('KYMMintStore: Successfully rehydrated from storage');
        }
      },
    }
  )
);
