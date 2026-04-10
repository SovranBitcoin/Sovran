import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { log, storeLog } from '@/shared/lib/logger';

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
        storeLog.debug('store.pricelist.set', { usd: data.usd?.btc });
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
        storeLog.debug('store.pricelist.set_btc_price', { price });
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
        storeLog.debug('store.pricelist.set_btc_prices', {
          usd: prices.USD,
          eur: prices.EUR,
          gbp: prices.GBP,
        });
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
        if (error) storeLog.warn('store.pricelist.error', { error });
        set({ error });
      },

      clearPricelist: () => {
        storeLog.info('store.pricelist.clear');
        set({
          pricelist: null,
          lastUpdated: null,
          error: null,
        });
      },

      clearAllData: async () => {
        storeLog.info('store.pricelist.clear_all');
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
          log.warn('store.pricelist.rehydrate_failed', { error });
        }
      },
    }
  )
);

export const useBtcPrice = (currency: SupportedCurrency = 'usd') => {
  return usePricelistStore((state) => state.getBtcPrice(currency));
};
