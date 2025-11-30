import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// Types
// ============================================================================

export interface BTCMapPlace {
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

// ============================================================================
// Constants
// ============================================================================

// Cache TTL: 1 hour (places don't change frequently)
const PLACES_CACHE_TTL = 60 * 60 * 1000; // 3600000ms

// Cache TTL for place details: 24 hours
const PLACE_DETAILS_CACHE_TTL = 24 * 60 * 60 * 1000; // 86400000ms

const BTCMAP_API_URL =
  'https://api.btcmap.org/v4/places?fields=id,lat,lon,icon,comments,boosted_until,deleted_at,updated_at&include_deleted=false';

const BTCMAP_PLACE_DETAILS_FIELDS =
  'id,lat,lon,icon,comments,boosted_until,deleted_at,updated_at,name,address,description,phone,website,twitter,facebook,instagram,email,opening_hours,created_at,verified_at,osm_id,osm_url,osm:contact:instagram,osm:contact:twitter,osm:contact:facebook,osm:contact:phone,osm:contact:website,osm:contact:email,required_app_url,osm:payment:onchain,osm:payment:lightning,osm:payment:lightning_contactless,osm:payment:bitcoin,osm:payment:uri,osm:payment:coinos,osm:payment:pouch,osm:amenity,osm:category,osm:survey:date,osm:check_date,osm:check_date:currency:XBT';

const getBTCMapPlaceDetailsURL = (id: number) =>
  `https://api.btcmap.org/v4/places/${id}?fields=${BTCMAP_PLACE_DETAILS_FIELDS}`;

// ============================================================================
// Store Interface
// ============================================================================

interface BTCMapState {
  // Places cache
  placesCache: PlacesCache | null;
  // Place details cache
  placeDetailsCache: PlaceDetailsCache;
  // Loading state
  isLoading: boolean;
  // Loading details state
  isLoadingDetails: boolean;
  // Selected place (for modal)
  selectedPlace: BTCMapPlaceDetails | null;
  // Error state
  error: string | null;
}

interface BTCMapActions {
  // Cache management
  getCachedPlaces: () => BTCMapPlace[] | null;
  setCachedPlaces: (places: BTCMapPlace[]) => void;
  isCacheStale: () => boolean;
  clearCache: () => void;

  // Fetch places (with caching)
  fetchPlaces: (forceRefresh?: boolean) => Promise<BTCMapPlace[]>;

  // Place details management
  fetchPlaceDetails: (id: number, forceRefresh?: boolean) => Promise<BTCMapPlaceDetails>;
  getCachedPlaceDetails: (id: number) => BTCMapPlaceDetails | null;
  setSelectedPlace: (place: BTCMapPlaceDetails | null) => void;
  clearSelectedPlace: () => void;

  // State management
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Utility methods
  clearAllData: () => Promise<void>;
}

type BTCMapStore = BTCMapState & BTCMapActions;

// ============================================================================
// Store Implementation
// ============================================================================

export const useBTCMapStore = create<BTCMapStore>()(
  persist(
    (set, get) => ({
      // Initial state
      placesCache: null,
      placeDetailsCache: {},
      isLoading: false,
      isLoadingDetails: false,
      selectedPlace: null,
      error: null,

      // Get cached places (returns null if no cache or stale)
      getCachedPlaces: () => {
        const cache = get().placesCache;
        if (!cache) return null;

        // Check if cache is stale
        const isStale = Date.now() - cache.timestamp > PLACES_CACHE_TTL;
        if (isStale) {
          console.log('BTCMapStore: Cache is stale');
          return null;
        }

        console.log('BTCMapStore: Returning cached places, count:', cache.data.length);
        return cache.data;
      },

      // Set cached places
      setCachedPlaces: (places: BTCMapPlace[]) => {
        console.log('BTCMapStore: Caching places, count:', places.length);
        set({
          placesCache: {
            data: places,
            timestamp: Date.now(),
          },
          error: null,
        });
      },

      // Check if cache is stale
      isCacheStale: () => {
        const cache = get().placesCache;
        if (!cache) return true;
        const isStale = Date.now() - cache.timestamp > PLACES_CACHE_TTL;
        return isStale;
      },

      // Clear cache
      clearCache: () => {
        console.log('BTCMapStore: Clearing cache');
        set({ placesCache: null, placeDetailsCache: {} });
      },

      // Fetch places with automatic caching
      fetchPlaces: async (forceRefresh = false) => {
        const state = get();

        // Return cached data if available and not forcing refresh
        if (!forceRefresh) {
          const cachedPlaces = state.getCachedPlaces();
          if (cachedPlaces && cachedPlaces.length > 0) {
            console.log('BTCMapStore: Using cached data');
            return cachedPlaces;
          }
        }

        // Fetch fresh data
        console.log('BTCMapStore: Fetching fresh data from API');
        set({ isLoading: true, error: null });

        try {
          const response = await fetch(BTCMAP_API_URL);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data: BTCMapPlace[] = await response.json();
          console.log('BTCMapStore: Fetched', data.length, 'places');

          // Cache the results
          state.setCachedPlaces(data);
          set({ isLoading: false });

          return data;
        } catch (error: any) {
          console.error('BTCMapStore: Failed to fetch places:', error);
          const errorMessage = error.message || 'Failed to load merchants';
          set({ isLoading: false, error: errorMessage });

          // Return cached data as fallback if available
          const cache = get().placesCache;
          if (cache && cache.data.length > 0) {
            console.log('BTCMapStore: Returning stale cache as fallback');
            return cache.data;
          }

          throw error;
        }
      },

      // Get cached place details
      getCachedPlaceDetails: (id: number) => {
        const cache = get().placeDetailsCache[id];
        if (!cache) return null;

        // Check if cache is stale
        const isStale = Date.now() - cache.timestamp > PLACE_DETAILS_CACHE_TTL;
        if (isStale) {
          console.log('BTCMapStore: Place details cache is stale for id:', id);
          return null;
        }

        return cache.data;
      },

      // Fetch place details with automatic caching
      fetchPlaceDetails: async (id: number, forceRefresh = false) => {
        const state = get();

        // Return cached data if available and not forcing refresh
        if (!forceRefresh) {
          const cached = state.getCachedPlaceDetails(id);
          if (cached) {
            console.log('BTCMapStore: Using cached place details for id:', id);
            set({ selectedPlace: cached });
            return cached;
          }
        }

        // Fetch fresh data
        console.log('BTCMapStore: Fetching place details for id:', id);
        set({ isLoadingDetails: true });

        try {
          const response = await fetch(getBTCMapPlaceDetailsURL(id));

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data: BTCMapPlaceDetails = await response.json();
          console.log('BTCMapStore: Fetched place details:', data.name || id);

          // Cache the results
          set((s) => ({
            placeDetailsCache: {
              ...s.placeDetailsCache,
              [id]: {
                data,
                timestamp: Date.now(),
              },
            },
            selectedPlace: data,
            isLoadingDetails: false,
          }));

          return data;
        } catch (error: any) {
          console.error('BTCMapStore: Failed to fetch place details:', error);
          set({ isLoadingDetails: false });
          throw error;
        }
      },

      // Set selected place
      setSelectedPlace: (place: BTCMapPlaceDetails | null) => {
        set({ selectedPlace: place });
      },

      // Clear selected place
      clearSelectedPlace: () => {
        set({ selectedPlace: null });
      },

      // Set loading state
      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      // Set error state
      setError: (error: string | null) => {
        set({ error });
      },

      // Clear all data
      clearAllData: async () => {
        try {
          console.log('BTCMapStore: Clearing all data');
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
      // Persist the cache data
      partialize: (state) => ({
        placesCache: state.placesCache,
        placeDetailsCache: state.placeDetailsCache,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('BTCMapStore: Failed to rehydrate from storage:', error);
        } else if (state?.placesCache) {
          console.log(
            'BTCMapStore: Rehydrated from storage, places count:',
            state.placesCache.data.length
          );
        }
      },
    }
  )
);

// ============================================================================
// Helper Hooks
// ============================================================================

// Hook to get places count
export const useBTCMapPlacesCount = () => {
  return useBTCMapStore((state) => state.placesCache?.data.length ?? 0);
};

// Hook to check if cache is stale
export const useIsBTCMapCacheStale = () => {
  return useBTCMapStore((state) => state.isCacheStale());
};

// Hook to get loading state
export const useBTCMapLoading = () => {
  return useBTCMapStore((state) => state.isLoading);
};

// Hook to get error state
export const useBTCMapError = () => {
  return useBTCMapStore((state) => state.error);
};

