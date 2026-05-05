import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';
import {
  type BtcMapPlace,
  type BtcMapPlaceDetails as BtcMapPlaceDetailsBase,
  BtcMapPlaceDetails as BtcMapPlaceDetailsSchema,
  BtcMapPlacesResponse,
  parseWith,
} from '@sovranbitcoin/schemas';
import { fetchJson, type RequestControls } from '@/shared/lib/apiClient';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

// Upstream BTCMap exposes colon-keyed `osm:*` properties under the schema's
// `passthrough()` envelope; surface the ones the detail screen actually
// reads as a typed extension so consumers don't need ad-hoc casts.
type OsmContactField =
  | 'osm:contact:instagram'
  | 'osm:contact:twitter'
  | 'osm:contact:facebook'
  | 'osm:contact:phone'
  | 'osm:contact:website'
  | 'osm:contact:email';

type OsmPaymentField =
  | 'osm:payment:onchain'
  | 'osm:payment:lightning'
  | 'osm:payment:lightning_contactless'
  | 'osm:payment:bitcoin'
  | 'osm:payment:uri'
  | 'osm:payment:coinos'
  | 'osm:payment:pouch';

type OsmMetaField =
  | 'osm:amenity'
  | 'osm:category'
  | 'osm:survey:date'
  | 'osm:check_date'
  | 'osm:check_date:currency:XBT';

export type BTCMapPlaceDetails = BtcMapPlaceDetailsBase &
  Partial<Record<OsmContactField | OsmPaymentField | OsmMetaField, string>>;

interface PlacesCache {
  data: BtcMapPlace[];
  timestamp: number;
}

interface PlaceDetailsCache {
  [id: number]: {
    data: BTCMapPlaceDetails;
    timestamp: number;
  };
}

/** 1 hour — places don't change frequently */
const PLACES_CACHE_TTL = 60 * 60 * 1000;

/** 24 hours for individual place details */
const PLACE_DETAILS_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Cap on persisted per-place detail entries. Bounds AsyncStorage write size
 * and memory: a power user browsing the map taps a few dozen merchants per
 * session — 200 entries covers months of activity while keeping the persisted
 * blob under ~1 MB at the schema's loose-object envelope.
 */
const MAX_PLACE_DETAILS_ENTRIES = 200;

const SOVRAN_API_BASE = 'https://api.sovran.money/api/btcmap';

function isCacheExpired(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp > ttl;
}

const parsePlaces = parseWith(BtcMapPlacesResponse, 'btcmap/places');
const parsePlaceDetails = parseWith(BtcMapPlaceDetailsSchema, 'btcmap/places/:id');

interface BTCMapState {
  placesCache: PlacesCache | null;
  placeDetailsCache: PlaceDetailsCache;
  isLoading: boolean;
  error: string | null;
}

interface BTCMapActions {
  getCachedPlaces: () => BtcMapPlace[] | null;
  fetchPlaces: (forceRefresh?: boolean, controls?: RequestControls) => Promise<BtcMapPlace[]>;
  fetchPlaceDetails: (
    id: number,
    forceRefresh?: boolean,
    controls?: RequestControls
  ) => Promise<BTCMapPlaceDetails>;
  getCachedPlaceDetails: (id: number) => BTCMapPlaceDetails | null;
  setError: (error: string | null) => void;
  /**
   * Reset to initial state and invalidate any in-flight `fetchPlaces`. Called
   * by `deleteAllProfiles` between `AsyncStorage.clear()` and `restartApp()`
   * so an in-flight 2–3s places fetch cannot resolve and re-populate cleared
   * storage. Bumps a module-local epoch so already-resolved fetches skip
   * their `set()` commit.
   */
  reset: () => void;
}

type BTCMapStore = BTCMapState & BTCMapActions;

// Module-level in-flight tracker. fetchPlaces parses ~40k places (2–3s of
// JS-thread work), so concurrent callers (e.g., the wallet's BitcoinNearYou
// and the explore tab's MapTeaserCard, which both mount on boot via native
// tabs) used to each kick off their own fetch + parse. Sharing the in-flight
// promise eliminates duplicate work and the second 3s blocker.
let inflightPlacesFetch: Promise<BtcMapPlace[]> | null = null;

// Epoch advanced by `reset()`. fetchPlaces captures the value at start and
// skips its set() if it has changed by the time the network response lands —
// otherwise an in-flight fetch resolving between AsyncStorage.clear() and
// restartApp() re-populates cleared storage with stale data.
let storeEpoch = 0;

// Persisted-shape schema. Envelope-only validation on `placesCache.data` —
// per-item parse against `BtcMapPlace` is a 2–3s JS-thread block on a 40k
// array (audit __audits__/44.json F-001), and a corrupt cache is recoverable
// via refetch, so the cost-benefit favours the envelope check. The fetch
// path still parses each item before writing to the store.
const PersistedPlacesCache = z
  .object({
    data: z.array(z.unknown()).max(200_000),
    timestamp: z.number().int().nonnegative(),
  })
  .nullable()
  .default(null);

const PersistedPlaceDetailEntry = z.looseObject({
  data: z.unknown(),
  timestamp: z.number().int().nonnegative(),
});

const PersistedBtcMapStore = z.object({
  placesCache: PersistedPlacesCache,
  placeDetailsCache: z.record(z.string().max(32), PersistedPlaceDetailEntry).default({}),
});

export const useBTCMapStore = create<BTCMapStore>()(
  persist(
    (set, get) => ({
      placesCache: null,
      placeDetailsCache: {},
      isLoading: false,
      error: null,

      getCachedPlaces: () => {
        const cache = get().placesCache;
        if (!cache || isCacheExpired(cache.timestamp, PLACES_CACHE_TTL)) return null;
        return cache.data;
      },

      fetchPlaces: async (forceRefresh = false, controls) => {
        const state = get();

        if (!forceRefresh) {
          const cached = state.getCachedPlaces();
          if (cached && cached.length > 0) return cached;
        }

        // Dedupe concurrent callers — return the in-flight promise instead
        // of starting a second fetch + parse.
        if (inflightPlacesFetch) return inflightPlacesFetch;

        storeLog.info('store.btc_map.fetch_places.start', { forceRefresh });
        const startTime = performance.now();
        const startEpoch = storeEpoch;
        set({ isLoading: true, error: null });

        const run = async (): Promise<BtcMapPlace[]> => {
          const result = await fetchJson(
            `${SOVRAN_API_BASE}/places`,
            parsePlaces,
            'btcmap/places',
            undefined,
            controls
          );

          // reset() ran while the request was in flight — drop the result
          // rather than re-populating storage that was just cleared.
          if (storeEpoch !== startEpoch) {
            storeLog.info('store.btc_map.fetch_places.discarded_after_reset', {
              startEpoch,
              currentEpoch: storeEpoch,
            });
            throw new Error('btcMapStore: fetchPlaces discarded after reset');
          }

          if (result.isErr()) {
            const errorMessage = result.error.message || 'Failed to load merchants';
            storeLog.error('store.btc_map.fetch_places.failed', {
              error: errorMessage,
              duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
            });
            set({ isLoading: false, error: errorMessage });

            const cache = get().placesCache;
            if (cache && cache.data.length > 0) return cache.data;

            throw result.error;
          }

          const data = result.value as BtcMapPlace[];
          storeLog.info('store.btc_map.fetch_places.success', {
            count: data.length,
            duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
          });

          set({
            placesCache: { data, timestamp: Date.now() },
            isLoading: false,
            error: null,
          });

          return data;
        };

        inflightPlacesFetch = run().finally(() => {
          inflightPlacesFetch = null;
        });
        return inflightPlacesFetch;
      },

      getCachedPlaceDetails: (id: number) => {
        const cache = get().placeDetailsCache[id];
        if (!cache || isCacheExpired(cache.timestamp, PLACE_DETAILS_CACHE_TTL)) return null;
        return cache.data;
      },

      fetchPlaceDetails: async (id: number, forceRefresh = false, controls) => {
        const state = get();

        if (!forceRefresh) {
          const cached = state.getCachedPlaceDetails(id);
          if (cached) return cached;
        }

        storeLog.info('store.btc_map.fetch_details.start', { id, forceRefresh });
        const startTime = performance.now();

        const result = await fetchJson(
          `${SOVRAN_API_BASE}/places/${id}`,
          parsePlaceDetails,
          'btcmap/places/:id',
          undefined,
          controls
        );

        if (result.isErr()) {
          storeLog.error('store.btc_map.fetch_details_failed', {
            error: redactError(result.error),
          });
          throw result.error;
        }

        const data = result.value as BTCMapPlaceDetails;
        storeLog.info('store.btc_map.fetch_details.success', {
          id,
          duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
        });

        set((s) => {
          const next: PlaceDetailsCache = {
            ...s.placeDetailsCache,
            [id]: { data, timestamp: Date.now() },
          };
          // Bound by insertion order — JS object keys are insertion-ordered
          // for non-numeric strings, but numeric ids sort numerically. Use
          // the entry with the oldest timestamp to drop instead, which gives
          // an LRU-by-write semantics that matches the TTL contract.
          const ids = Object.keys(next);
          if (ids.length > MAX_PLACE_DETAILS_ENTRIES) {
            let oldestId: string | null = null;
            let oldestTs = Infinity;
            for (const key of ids) {
              const ts = next[Number(key)].timestamp;
              if (ts < oldestTs) {
                oldestTs = ts;
                oldestId = key;
              }
            }
            if (oldestId !== null) delete next[Number(oldestId)];
          }
          return { placeDetailsCache: next };
        });

        return data;
      },

      setError: (error) => {
        if (error) storeLog.warn('store.btc_map.set_error', { error });
        set({ error });
      },

      reset: () => {
        storeEpoch += 1;
        inflightPlacesFetch = null;
        storeLog.info('store.btc_map.reset', { epoch: storeEpoch });
        set({
          placesCache: null,
          placeDetailsCache: {},
          isLoading: false,
          error: null,
        });
      },
    }),
    persistConfig({
      name: 'btcmap-store',
      storage: AsyncStorage,
      schema: PersistedBtcMapStore,
      logKey: 'btc_map',
      partialize: (state) => ({
        placesCache: state.placesCache,
        placeDetailsCache: state.placeDetailsCache,
      }),
    })
  )
);
