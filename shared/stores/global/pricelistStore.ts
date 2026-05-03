import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

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
  getBtcPrice: (currency?: SupportedCurrency) => number | null;
  isStale: (maxAgeMinutes?: number) => boolean;
}

type PricelistStore = PricelistState & PricelistActions;

const PersistedPricelistStore = z.object({
  pricelist: z
    .looseObject({
      usd: z.looseObject({ btc: z.number() }).optional(),
      eur: z.looseObject({ btc: z.number() }).optional(),
      gbp: z.looseObject({ btc: z.number() }).optional(),
    })
    .nullable()
    .default(null),
  lastUpdated: z.number().int().nonnegative().nullable().default(null),
});

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
    persistConfig({
      name: 'pricelist-store',
      storage: AsyncStorage,
      schema: PersistedPricelistStore,
      partialize: (state) => ({
        pricelist: state.pricelist,
        lastUpdated: state.lastUpdated,
      }),
    })
  )
);

export const useBtcPrice = (currency: SupportedCurrency = 'usd') => {
  return usePricelistStore((state) => state.getBtcPrice(currency));
};
