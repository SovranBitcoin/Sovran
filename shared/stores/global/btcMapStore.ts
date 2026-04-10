import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { log, storeLog } from '@/shared/lib/logger';

interface BTCMapPlace {
  id: number;
  lat: number;
  lon: number;
  icon: string;
  comments?: number;
  boosted_until?: string;
  deleted_at?: string | null;
  updated_at: string;
}

export interface BTCMapPlaceDetails {
  id: number;
  lat: number;
  lon: number;
  icon: string;
  updated_at: string;
  name?: string;
  address?: string;
  description?: string;
  phone?: string;
  website?: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  email?: string;
  opening_hours?: string;
  created_at?: string;
  verified_at?: string;
  osm_id?: string;
  osm_url?: string;
  'osm:contact:instagram'?: string;
  'osm:contact:twitter'?: string;
  'osm:contact:facebook'?: string;
  'osm:contact:phone'?: string;
  'osm:contact:website'?: string;
  'osm:contact:email'?: string;
  required_app_url?: string;
  'osm:payment:onchain'?: string;
  'osm:payment:lightning'?: string;
  'osm:payment:lightning_contactless'?: string;
  'osm:payment:bitcoin'?: string;
  'osm:payment:uri'?: string;
  'osm:payment:coinos'?: string;
  'osm:payment:pouch'?: string;
  'osm:amenity'?: string;
  'osm:category'?: string;
  'osm:survey:date'?: string;
  'osm:check_date'?: string;
  'osm:check_date:currency:XBT'?: string;
}

interface PlacesCache {
  data: BTCMapPlace[];
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

const SOVRAN_API_BASE = 'https://api.sovran.money/api/btcmap';

function isCacheExpired(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp > ttl;
}

interface BTCMapState {
  placesCache: PlacesCache | null;
  placeDetailsCache: PlaceDetailsCache;
  isLoading: boolean;
  isLoadingDetails: boolean;
  selectedPlace: BTCMapPlaceDetails | null;
  error: string | null;
}

interface BTCMapActions {
  getCachedPlaces: () => BTCMapPlace[] | null;
  fetchPlaces: (forceRefresh?: boolean) => Promise<BTCMapPlace[]>;
  fetchPlaceDetails: (id: number, forceRefresh?: boolean) => Promise<BTCMapPlaceDetails>;
  getCachedPlaceDetails: (id: number) => BTCMapPlaceDetails | null;
  setSelectedPlace: (place: BTCMapPlaceDetails | null) => void;
  setError: (error: string | null) => void;
  clearCache: () => void;
  clearAllData: () => Promise<void>;
}

type BTCMapStore = BTCMapState & BTCMapActions;

export const useBTCMapStore = create<BTCMapStore>()(
  persist(
    (set, get) => ({
      placesCache: null,
      placeDetailsCache: {},
      isLoading: false,
      isLoadingDetails: false,
      selectedPlace: null,
      error: null,

      getCachedPlaces: () => {
        const cache = get().placesCache;
        if (!cache || isCacheExpired(cache.timestamp, PLACES_CACHE_TTL)) return null;
        return cache.data;
      },

      fetchPlaces: async (forceRefresh = false) => {
        const state = get();

        if (!forceRefresh) {
          const cached = state.getCachedPlaces();
          if (cached && cached.length > 0) return cached;
        }

        storeLog.info('store.btc_map.fetch_places.start', { forceRefresh });
        const startTime = performance.now();
        set({ isLoading: true, error: null });

        try {
          const response = await fetch(`${SOVRAN_API_BASE}/places`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data: BTCMapPlace[] = await response.json();
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
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load merchants';
          storeLog.error('store.btc_map.fetch_places.failed', {
            error: errorMessage,
            duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
          });
          set({ isLoading: false, error: errorMessage });

          const cache = get().placesCache;
          if (cache && cache.data.length > 0) return cache.data;

          throw error;
        }
      },

      getCachedPlaceDetails: (id: number) => {
        const cache = get().placeDetailsCache[id];
        if (!cache || isCacheExpired(cache.timestamp, PLACE_DETAILS_CACHE_TTL)) return null;
        return cache.data;
      },

      fetchPlaceDetails: async (id: number, forceRefresh = false) => {
        const state = get();

        if (!forceRefresh) {
          const cached = state.getCachedPlaceDetails(id);
          if (cached) {
            set({ selectedPlace: cached });
            return cached;
          }
        }

        storeLog.info('store.btc_map.fetch_details.start', { id, forceRefresh });
        const startTime = performance.now();
        set({ isLoadingDetails: true });

        try {
          const response = await fetch(`${SOVRAN_API_BASE}/places/${id}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data: BTCMapPlaceDetails = await response.json();
          storeLog.info('store.btc_map.fetch_details.success', {
            id,
            duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
          });

          set((s) => ({
            placeDetailsCache: {
              ...s.placeDetailsCache,
              [id]: { data, timestamp: Date.now() },
            },
            selectedPlace: data,
            isLoadingDetails: false,
          }));

          return data;
        } catch (error: unknown) {
          log.error('store.btc_map.fetch_details_failed', { error });
          set({ isLoadingDetails: false });
          throw error;
        }
      },

      setSelectedPlace: (place) => {
        storeLog.debug('store.btc_map.set_selected_place', { id: place?.id ?? null });
        set({ selectedPlace: place });
      },

      setError: (error) => {
        if (error) storeLog.warn('store.btc_map.set_error', { error });
        set({ error });
      },

      clearCache: () => {
        storeLog.info('store.btc_map.clear_cache');
        set({ placesCache: null, placeDetailsCache: {} });
      },

      clearAllData: async () => {
        try {
          await AsyncStorage.removeItem('btcmap-store');
          set({
            placesCache: null,
            placeDetailsCache: {},
            isLoading: false,
            isLoadingDetails: false,
            selectedPlace: null,
            error: null,
          });
        } catch (error) {
          log.error('store.btc_map.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'btcmap-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        placesCache: state.placesCache,
        placeDetailsCache: state.placeDetailsCache,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          log.warn('store.btc_map.rehydrate_failed', { error });
        }
      },
    }
  )
);
