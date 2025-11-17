import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PricelistData {
  usd: {
    btc: number;
  };
  eur?: {
    btc: number;
  };
  gbp?: {
    btc: number;
  };
}

export interface PricelistState {
  pricelist: PricelistData | null;
  isLoading: boolean;
  lastUpdated: number | null;
  error: string | null;
}

interface PricelistActions {
  setPricelist: (data: PricelistData) => void;
  setBtcPrice: (price: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearPricelist: () => void;
  clearAllData: () => Promise<void>;
  getBtcPrice: (currency?: string) => number | null;
  isStale: (maxAgeMinutes?: number) => boolean;
}

type PricelistStore = PricelistState & PricelistActions;

export const usePricelistStore = create<PricelistStore>()(
  persist(
    (set, get) => ({
      // Initial state
      pricelist: null,
      isLoading: false,
      lastUpdated: null,
      error: null,

      // Actions
      setPricelist: (data: PricelistData) => {
        set({
          pricelist: data,
          lastUpdated: Date.now(),
          error: null,
        });
      },

      setBtcPrice: (price: number) => {
        const currentState = get();
        const newPricelist: PricelistData = {
          usd: { btc: price },
          ...currentState.pricelist,
        };

        set({
          pricelist: newPricelist,
          lastUpdated: Date.now(),
          error: null,
        });
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      setError: (error: string | null) => {
        set({ error });
      },

      clearPricelist: () => {
        set({
          pricelist: null,
          lastUpdated: null,
          error: null,
        });
      },

      // Clear all data from both state and storage
      clearAllData: async () => {
        try {
          // Clear from AsyncStorage
          await AsyncStorage.removeItem('pricelist-store');
          // Reset state to initial values
          set({
            pricelist: null,
            isLoading: false,
            lastUpdated: null,
            error: null,
          });
        } catch (error) {
          throw error;
        }
      },

      getBtcPrice: (currency: string = 'usd') => {
        const currentState = get();
        if (!currentState.pricelist) return null;

        const price = (currentState.pricelist as any)[currency]?.btc;
        return price || null;
      },

      isStale: (maxAgeMinutes: number = 5) => {
        const currentState = get();
        if (!currentState.lastUpdated) return true;

        const ageMinutes = (Date.now() - currentState.lastUpdated) / (1000 * 60);
        const isStale = ageMinutes > maxAgeMinutes;
        return isStale;
      },
    }),
    {
      name: 'pricelist-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the pricelist data and lastUpdated timestamp
      partialize: (state) => ({
        pricelist: state.pricelist,
        lastUpdated: state.lastUpdated,
      }),
      onRehydrateStorage: () => (state, error) => {
        console.log(
          'PricelistStore: onRehydrateStorage called with state:',
          state,
          'error:',
          error
        );
        if (error) {
          console.warn('PricelistStore: Failed to rehydrate from storage:', error);
        } else {
          console.log('PricelistStore: Successfully rehydrated from storage:', state?.pricelist);
        }
      },
    }
  )
);

// Helper hook for easy access to BTC price
export const useBtcPrice = (currency: string = 'usd') => {
  return usePricelistStore((state) => state.getBtcPrice(currency));
};

// Helper hook for checking if data is stale
export const useIsPricelistStale = (maxAgeMinutes: number = 5) => {
  return usePricelistStore((state) => state.isStale(maxAgeMinutes));
};
