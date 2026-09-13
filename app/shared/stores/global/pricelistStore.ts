import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

interface PricelistData {
  usd?: {
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
  serverUpdatedAt: number | null;
  error: string | null;
}

export interface BitcoinPrices {
  USD: number;
  GBP: number;
  EUR: number;
}

type SupportedCurrency = keyof PricelistData;

// Nagg refreshes upstream prices hourly; allow two refresh windows before stale.
export const PRICE_STALE_MINUTES = 120;

interface PricelistActions {
  setBtcPrices: (prices: Partial<BitcoinPrices>, serverUpdatedAtSeconds?: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
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
  serverUpdatedAt: z.number().int().nonnegative().nullable().default(null).catch(null),
});

export const usePricelistStore = create<PricelistStore>()(
  persist(
    (set, get) => ({
      pricelist: null,
      isLoading: false,
      lastUpdated: null,
      serverUpdatedAt: null,
      error: null,

      setBtcPrices: (prices, serverUpdatedAtSeconds) => {
        if (prices.USD === undefined && prices.EUR === undefined && prices.GBP === undefined)
          return;
        storeLog.debug('store.pricelist.set_btc_prices', {
          usd: prices.USD,
          eur: prices.EUR,
          gbp: prices.GBP,
        });
        set((state) => ({
          pricelist: {
            ...state.pricelist,
            ...(prices.USD !== undefined ? { usd: { btc: prices.USD } } : {}),
            ...(prices.EUR !== undefined ? { eur: { btc: prices.EUR } } : {}),
            ...(prices.GBP !== undefined ? { gbp: { btc: prices.GBP } } : {}),
          },
          lastUpdated: Date.now(),
          serverUpdatedAt: serverUpdatedAtSeconds ?? null,
          error: null,
        }));
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      setError: (error: string | null) => {
        if (error) storeLog.warn('store.pricelist.error', { error });
        set({ error });
      },

      getBtcPrice: (currency: SupportedCurrency = 'usd') => {
        const { pricelist } = get();
        return pricelist?.[currency]?.btc ?? null;
      },

      isStale: (maxAgeMinutes: number = PRICE_STALE_MINUTES) => {
        const { lastUpdated, serverUpdatedAt } = get();
        const updatedAtMs = serverUpdatedAt === null ? lastUpdated : serverUpdatedAt * 1000;
        if (updatedAtMs === null) return true;
        return (Date.now() - updatedAtMs) / (1000 * 60) > maxAgeMinutes;
      },
    }),
    persistConfig({
      name: 'pricelist-store',
      storage: AsyncStorage,
      schema: PersistedPricelistStore,
      partialize: (state) => ({
        pricelist: state.pricelist,
        lastUpdated: state.lastUpdated,
        serverUpdatedAt: state.serverUpdatedAt,
      }),
    })
  )
);

export const useBtcPrice = (currency: SupportedCurrency = 'usd') => {
  return usePricelistStore((state) => state.getBtcPrice(currency));
};
