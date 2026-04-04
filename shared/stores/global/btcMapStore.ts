import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

        set({ isLoading: true, error: null });

        try {
          const response = await fetch(`${SOVRAN_API_BASE}/places`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data: BTCMapPlace[] = await response.json();

          set({
            placesCache: { data, timestamp: Date.now() },
            isLoading: false,
            error: null,
          });

          return data;
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load merchants';
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

        set({ isLoadingDetails: true });

        try {
          const response = await fetch(
            `${SOVRAN_API_BASE}/places/${id}`
          );
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data: BTCMapPlaceDetails = await response.json();

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
          console.error('BTCMapStore: Failed to fetch place details:', error);
          set({ isLoadingDetails: false });
          throw error;
        }
      },

      setSelectedPlace: (place) => set({ selectedPlace: place }),

      setError: (error) => set({ error }),

      clearCache: () => set({ placesCache: null, placeDetailsCache: {} }),

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
          console.error('BTCMapStore: Error clearing data:', error);
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
          console.warn('BTCMapStore: Failed to rehydrate from storage:', error);
        }
      },
    }
  )
);
