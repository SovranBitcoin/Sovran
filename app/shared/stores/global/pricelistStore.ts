import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { FIAT_UNITS, type FiatUnit } from 'wallet/units';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

/** BTC price per fiat unit of the wallet's unit registry. */
type PricelistData = Partial<Record<FiatUnit, { btc: number }>>;

interface PricelistState {
  pricelist: PricelistData | null;
  isLoading: boolean;
  lastUpdated: number | null;
  serverUpdatedAt: number | null;
  error: string | null;
}

/** nagg's `/app/rates` wire shape: upper-case currency codes. */
export type BitcoinPrices = Record<Uppercase<FiatUnit>, number>;

type SupportedCurrency = FiatUnit;

const wireCode = (unit: FiatUnit) => unit.toUpperCase() as Uppercase<FiatUnit>;
/** The rate codes nagg is asked about: one per fiat unit of the registry. */
export const RATE_CODES = FIAT_UNITS.map(wireCode);

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
    .looseObject(
      Object.fromEntries(
        FIAT_UNITS.map((unit) => [unit, z.looseObject({ btc: z.number() }).optional()])
      )
    )
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
        const received: PricelistData = {};
        for (const unit of FIAT_UNITS) {
          const price = prices[wireCode(unit)];
          if (price !== undefined) received[unit] = { btc: price };
        }
        if (Object.keys(received).length === 0) return;
        storeLog.debug('store.pricelist.set_btc_prices', {
          ...Object.fromEntries(FIAT_UNITS.map((unit) => [unit, received[unit]?.btc])),
        });
        set((state) => ({
          pricelist: { ...state.pricelist, ...received },
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
