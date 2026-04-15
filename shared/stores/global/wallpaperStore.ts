// ---------------------------------------------------------------------------
// Wallpaper Store — persisted state for downloaded wallpapers
//
// Manages the server catalog cache and locally downloaded wallpapers.
// On rehydration, re-registers all downloaded themes into the theme engine
// and sets _hasHydrated = true so ThemeProvider can safely render.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from '@/shared/lib/logger';
import {
  registerDownloadedTheme,
  unregisterDownloadedTheme,
} from '@/shared/lib/downloadedThemeRegistry';
import {
  downloadWallpaper as downloadWallpaperFile,
  deleteWallpaper as deleteWallpaperFile,
  isWallpaperDownloaded,
  getWallpaperUri,
  cleanupOrphanedFiles,
} from '@/shared/lib/wallpaperStorage';
import { useSettingsStore } from './settingsStore';
import type { ThemePalette } from '@/themes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DominantColor {
  hex: string;
  hue: number;
  saturation: number;
  lightness: number;
}

interface GradientColor {
  hex: string;
  position: 'light' | 'mid' | 'dark';
  hsb: { hue: number; saturation: number; brightness: number };
}

export interface WallpaperCatalogEntry {
  eventId: string;
  themeName: string;
  displayName: string;
  blossomUrl: string;
  thumbUrl: string;
  sha256: string;
  fileSize: number;
  dimensions: string;
  albumSlug: string;
  palette: ThemePalette;
  dominantColors: DominantColor[];
  gradientColors: GradientColor[];
  createdAt: number;
}

export interface DownloadedWallpaper extends WallpaperCatalogEntry {
  localUri: string;
  downloadedAt: number;
}

interface AlbumMeta {
  slug: string;
  displayName: string;
  description: string;
  sortOrder: number;
  author?: { pubkey: string; displayName: string; picture: string; followers?: number } | null;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface WallpaperState {
  _hasHydrated: boolean;

  // Server catalog (refreshed from API)
  catalog: WallpaperCatalogEntry[];
  albums: AlbumMeta[];
  catalogLastFetched: number;

  // Downloaded wallpapers (persisted, keyed by themeName)
  downloaded: Record<string, DownloadedWallpaper>;

  // Active download progress (transient, not persisted)
  activeDownloads: Record<string, number>;

  // Actions
  setCatalog: (wallpapers: WallpaperCatalogEntry[], albums: AlbumMeta[]) => void;
  downloadWallpaper: (entry: WallpaperCatalogEntry, onProgress?: (p: number) => void) => Promise<boolean>;
  removeDownloaded: (themeName: string) => Promise<void>;
  removeAlbumDownloads: (albumSlug: string) => Promise<void>;
  verifyIntegrity: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWallpaperStore = create<WallpaperState>()(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      catalog: [],
      albums: [],
      catalogLastFetched: 0,
      downloaded: {},
      activeDownloads: {},

      setCatalog: (wallpapers, albums) => {
        set({
          catalog: wallpapers,
          albums,
          catalogLastFetched: Date.now(),
        });
        log.info('wallpaper.catalog.updated', {
          count: wallpapers.length,
          albums: albums.length,
        });
      },

      downloadWallpaper: async (entry, onProgress) => {
        const { themeName } = entry;

        // Set initial progress
        set((s) => ({
          activeDownloads: { ...s.activeDownloads, [themeName]: 0 },
        }));

        try {
          const localUri = await downloadWallpaperFile(
            entry.blossomUrl,
            themeName,
            (progress) => {
              set((s) => ({
                activeDownloads: { ...s.activeDownloads, [themeName]: progress },
              }));
              onProgress?.(progress);
            },
          );

          const downloaded: DownloadedWallpaper = {
            ...entry,
            localUri,
            downloadedAt: Date.now(),
          };

          // Register theme in engine
          registerDownloadedTheme({
            themeName,
            displayName: entry.displayName,
            localUri,
            palette: entry.palette,
            dominantColors: entry.dominantColors,
            gradientColors: entry.gradientColors,
          });

          // Update store
          set((s) => {
            const { [themeName]: _, ...rest } = s.activeDownloads;
            return {
              downloaded: { ...s.downloaded, [themeName]: downloaded },
              activeDownloads: rest,
            };
          });

          return true;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
          log.error('wallpaper.download.failed', { themeName, error: message, url: entry.blossomUrl });

          // Clear progress
          set((s) => {
            const { [themeName]: _, ...rest } = s.activeDownloads;
            return { activeDownloads: rest };
          });

          return false;
        }
      },

      removeDownloaded: async (themeName) => {
        // Active theme protection
        const currentTheme = useSettingsStore.getState().getTheme();
        if (currentTheme === themeName) {
          useSettingsStore.getState().setTheme('dark');
          // Wait a tick for theme change to propagate
          await new Promise((r) => setTimeout(r, 50));
        }

        // Unregister from theme engine
        unregisterDownloadedTheme(themeName);

        // Delete file
        await deleteWallpaperFile(themeName);

        // Update store
        set((s) => {
          const { [themeName]: _, ...rest } = s.downloaded;
          return { downloaded: rest };
        });
      },

      removeAlbumDownloads: async (albumSlug) => {
        const { downloaded } = get();
        const toRemove = Object.values(downloaded).filter(
          (w) => w.albumSlug === albumSlug,
        );

        for (const w of toRemove) {
          await get().removeDownloaded(w.themeName);
        }
      },

      verifyIntegrity: async () => {
        const { downloaded } = get();
        const orphans: string[] = [];

        for (const [themeName, wallpaper] of Object.entries(downloaded)) {
          const exists = await isWallpaperDownloaded(themeName);
          if (!exists) {
            log.warn('wallpaper.integrity.missing', { themeName });
            unregisterDownloadedTheme(themeName);
            orphans.push(themeName);
          }
        }

        if (orphans.length > 0) {
          // Check if active theme is orphaned
          const currentTheme = useSettingsStore.getState().getTheme();
          if (orphans.includes(currentTheme)) {
            useSettingsStore.getState().setTheme('dark');
          }

          // Remove orphans from store
          set((s) => {
            const newDownloaded = { ...s.downloaded };
            for (const name of orphans) {
              delete newDownloaded[name];
            }
            return { downloaded: newDownloaded };
          });
        }

        // Clean up files not tracked in store
        const trackedNames = new Set(Object.keys(get().downloaded));
        await cleanupOrphanedFiles(trackedNames);
      },
    }),
    {
      name: 'wallpaper-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        catalog: state.catalog,
        albums: state.albums,
        catalogLastFetched: state.catalogLastFetched,
        downloaded: state.downloaded,
        // _hasHydrated and activeDownloads are excluded (transient)
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          log.warn('wallpaper.store.rehydrate_failed', { error });
          useWallpaperStore.setState({ _hasHydrated: true });
          return;
        }

        if (state?.downloaded) {
          // Re-register all downloaded themes into the theme engine
          for (const [themeName, wallpaper] of Object.entries(state.downloaded)) {
            registerDownloadedTheme({
              themeName,
              displayName: wallpaper.displayName,
              localUri: wallpaper.localUri,
              palette: wallpaper.palette,
              dominantColors: wallpaper.dominantColors,
              gradientColors: wallpaper.gradientColors,
            });
          }
          log.info('wallpaper.store.rehydrated', {
            downloaded: Object.keys(state.downloaded).length,
            catalog: state.catalog?.length ?? 0,
          });
        }

        useWallpaperStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
