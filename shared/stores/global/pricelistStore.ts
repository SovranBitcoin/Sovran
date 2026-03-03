import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PricelistData {
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

interface PricelistState {
  pricelist: PricelistData | null;
  isLoading: boolean;
  lastUpdated: number | null;
  error: string | null;
}

export interface BitcoinPrices {
  USD: number;
  GBP: number;
  EUR: number;
}

type SupportedCurrency = keyof PricelistData;

interface PricelistActions {
  setPricelist: (data: PricelistData) => void;
  setBtcPrice: (price: number) => void;
  setBtcPrices: (prices: BitcoinPrices) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearPricelist: () => void;
  clearAllData: () => Promise<void>;
  getBtcPrice: (currency?: SupportedCurrency) => number | null;
  isStale: (maxAgeMinutes?: number) => boolean;
}

type PricelistStore = PricelistState & PricelistActions;

export const usePricelistStore = create<PricelistStore>()(
  persist(
    (set, get) => ({
      pricelist: null,
      isLoading: false,
      lastUpdated: null,
      error: null,

      setPricelist: (data: PricelistData) => {
        set({
          pricelist: data,
          lastUpdated: Date.now(),
          error: null,
        });
      },

      /**
       * Sets only the USD/BTC price, preserving existing EUR/GBP rates.
       * Spread order: existing first, then usd override.
       */
      setBtcPrice: (price: number) => {
        set((state) => ({
          pricelist: {
            ...state.pricelist,
            usd: { btc: price },
          },
          lastUpdated: Date.now(),
          error: null,
        }));
      },

      setBtcPrices: (prices: BitcoinPrices) => {
        set({
          pricelist: {
            usd: { btc: prices.USD },
            eur: { btc: prices.EUR },
            gbp: { btc: prices.GBP },
          },
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

      clearAllData: async () => {
        await AsyncStorage.removeItem('pricelist-store');
        set({
          pricelist: null,
          isLoading: false,
          lastUpdated: null,
          error: null,
        });
      },

      getBtcPrice: (currency: SupportedCurrency = 'usd') => {
        const { pricelist } = get();
        return pricelist?.[currency]?.btc ?? null;
      },

      isStale: (maxAgeMinutes: number = 5) => {
        const { lastUpdated } = get();
        if (!lastUpdated) return true;
        return (Date.now() - lastUpdated) / (1000 * 60) > maxAgeMinutes;
      },
    }),
    {
      name: 'pricelist-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pricelist: state.pricelist,
        lastUpdated: state.lastUpdated,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('PricelistStore: Failed to rehydrate:', error);
        }
      },
    }
  )
);

export const useBtcPrice = (currency: SupportedCurrency = 'usd') => {
  return usePricelistStore((state) => state.getBtcPrice(currency));
};
