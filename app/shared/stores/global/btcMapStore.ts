import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';
import {
  BtcMapPlace,
  type BtcMapPlaceDetails as BtcMapPlaceDetailsBase,
  BtcMapPlaceDetails as BtcMapPlaceDetailsSchema,
  parseWith,
} from '@sovranbitcoin/schemas';
import { err, ok, type Result } from 'neverthrow';
import { ApiParseError, fetchJson } from '@/shared/lib/apiClient';
import { type RequestControls } from 'wallet';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { createFileCacheStorage } from '@/shared/lib/persist/fileCacheStorage';

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

/** 24 hours: places change slowly, and each refetch parses ~30k rows. */
const PLACES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 24 hours for individual place details */
const PLACE_DETAILS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cap on persisted per-place detail entries. Bounds AsyncStorage write size
 * and memory: a power user browsing the map taps a few dozen merchants per
 * session — 200 entries covers months of activity while keeping the persisted
 * blob under ~1 MB at the schema's loose-object envelope.
 */
const MAX_PLACE_DETAILS_ENTRIES = 200;

const BTCMAP_BASE_URL = 'https://api.btcmap.org/v4';

// BTCMap v4 omits every attribute except `id` unless requested via `?fields=`.
// Deliberately omit `deleted_at` from the list query so v4 returns active places only,
// and omit unused `comments`/`boosted_until` to keep the ~30k-row payload lean.
const BTCMAP_PLACES_FIELDS = ['id', 'lat', 'lon', 'icon', 'updated_at'].join(',');

const BTCMAP_PLACE_DETAILS_FIELDS = [
  'id',
  'lat',
  'lon',
  'icon',
  'updated_at',
  'name',
  'address',
  'description',
  'phone',
  'website',
  'twitter',
  'facebook',
  'instagram',
  'email',
  'opening_hours',
  'created_at',
  'verified_at',
  'osm_id',
  'osm_url',
  'required_app_url',
  'osm:contact:instagram',
  'osm:contact:twitter',
  'osm:contact:facebook',
  'osm:contact:phone',
  'osm:contact:website',
  'osm:contact:email',
  'osm:payment:onchain',
  'osm:payment:lightning',
  'osm:payment:lightning_contactless',
  'osm:payment:bitcoin',
  'osm:payment:uri',
  'osm:payment:coinos',
  'osm:payment:pouch',
  'osm:amenity',
  'osm:category',
  'osm:survey:date',
  'osm:check_date',
  'osm:check_date:currency:XBT',
].join(',');

export const BTCMAP_PLACES_URL = `${BTCMAP_BASE_URL}/places?fields=${BTCMAP_PLACES_FIELDS}`;
export const btcMapPlaceDetailsUrl = (id: number) =>
  `${BTCMAP_BASE_URL}/places/${id}?fields=${BTCMAP_PLACE_DETAILS_FIELDS}`;

function isCacheExpired(timestampMs: number, ttlMs: number, nowMs: number): boolean {
  return nowMs - timestampMs > ttlMs;
}

// Shared schemas tolerate new upstream fields; detail parsing preserves osm:*.
// The places list is checked as an envelope here (the same 200k cap as
// `BtcMapPlacesResponse`) and its rows in chunks below.
const PLACES_WHERE = 'app/btcmap/places';
const parsePlacesEnvelope = parseWith(z.array(z.unknown()).max(200_000), PLACES_WHERE);
const PlaceRows = z.array(BtcMapPlace);
/** Rows parsed per JS-thread turn: a few ms each, instead of one 2–3 s block. */
const PLACES_PARSE_CHUNK = 2_000;

/**
 * Parse every row exactly as `BtcMapPlacesResponse` does, yielding to the JS
 * thread between chunks so animations and touches keep running.
 */
async function parsePlacesInChunks(rows: unknown[]): Promise<Result<BtcMapPlace[], Error>> {
  const places: BtcMapPlace[] = [];
  for (let start = 0; start < rows.length; start += PLACES_PARSE_CHUNK) {
    if (start > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const parsed = PlaceRows.safeParse(rows.slice(start, start + PLACES_PARSE_CHUNK));
    if (!parsed.success) {
      const error = new ApiParseError({
        type: 'schema/zod',
        where: PLACES_WHERE,
        issues: parsed.error.issues.map((issue) => ({
          ...issue,
          path: [start + Number(issue.path[0]), ...issue.path.slice(1)],
        })),
      });
      storeLog.warn('store.btc_map.fetch_places.parse_failed', { issues: error.issues });
      return err(error);
    }
    for (const place of parsed.data) places.push(place);
  }
  return ok(places);
}

/** Same rows in the same order: a refetch that changed nothing keeps the old array. */
function samePlaces(a: readonly BtcMapPlace[], b: readonly BtcMapPlace[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const before = a[index] as Record<string, unknown>;
    const after = b[index] as Record<string, unknown>;
    const keys = Object.keys(after);
    if (keys.length !== Object.keys(before).length) return false;
    for (const key of keys) if (before[key] !== after[key]) return false;
  }
  return true;
}
const parsePlaceDetails = parseWith(BtcMapPlaceDetailsSchema, 'app/btcmap/places/:id');

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
// per-item parse against `BtcMapPlace` is a 2-3s JS-thread block on a 40k
// array, and a corrupt cache is recoverable via refetch, so the cost-benefit
// favours the envelope check. The fetch path still parses each item before
// writing to the store.
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

export const useBTCMapStore = create<BTCMapStore>({ name: 'btcmap-store', scope: 'global' })(
  persist(
    (set, get) => ({
      placesCache: null,
      placeDetailsCache: {},
      isLoading: false,
      error: null,

      getCachedPlaces: () => {
        const cache = get().placesCache;
        if (!cache || isCacheExpired(cache.timestamp, PLACES_CACHE_TTL_MS, Date.now())) return null;
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
          const envelope = await fetchJson(
            BTCMAP_PLACES_URL,
            parsePlacesEnvelope,
            PLACES_WHERE,
            undefined,
            controls
          );
          const result = envelope.isOk()
            ? await parsePlacesInChunks(envelope.value)
            : err(envelope.error);

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

          const previous = get().placesCache?.data;
          const data = previous && samePlaces(previous, result.value) ? previous : result.value;
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
        if (!cache || isCacheExpired(cache.timestamp, PLACE_DETAILS_CACHE_TTL_MS, Date.now()))
          return null;
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
          btcMapPlaceDetailsUrl(id),
          parsePlaceDetails,
          'app/btcmap/places/:id',
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
      // Thousands of places, over 2 MB: too large for AsyncStorage on Android.
      storage: createFileCacheStorage(),
      // A cache of public map data: a bad blob is simply replaced.
      preserveUnreadable: false,
      // Loading and error flips must not reserialise and rewrite the 2 MB file.
      skipUnchangedSaves: true,
      schema: PersistedBtcMapStore,
      logKey: 'btc_map',
      partialize: (state) => ({
        placesCache: state.placesCache,
        placeDetailsCache: state.placeDetailsCache,
      }),
    })
  )
);
