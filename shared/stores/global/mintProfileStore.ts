import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { log, storeLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey } from '@/shared/lib/url';

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
  clearAllData: () => Promise<void>;
}

type MintProfileStore = MintProfileState & MintProfileActions;

export const useMintProfileStore = create<MintProfileStore>()(
  persist(
    (set, get) => ({
      cache: {},

      getCached: (mintUrl: string) => {
        return get().cache[normalizeMintUrlKey(mintUrl)];
      },

      setCached: (mintUrl: string, followers: number, reputation: number) => {
        const normalized = normalizeMintUrlKey(mintUrl);
        storeLog.debug('store.mint_profile.set_cached', { mintUrl: normalized, followers, reputation });
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

      clearAllData: async () => {
        try {
          await AsyncStorage.removeItem('mint-profile-store');
          set({ cache: {} });
        } catch (error) {
          log.error('store.mint_profile.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'mint-profile-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ cache: state.cache }),
    }
  )
);
