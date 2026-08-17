// ---------------------------------------------------------------------------
// Wallpaper Store — persisted state for downloaded wallpapers
//
// Manages the server catalog cache and locally downloaded wallpapers.
// On rehydration, re-registers all downloaded themes into the theme engine
// and sets _hasHydrated = true so ThemeProvider can safely render.
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';
import {
  registerDownloadedTheme,
  unregisterDownloadedTheme,
} from '@/shared/lib/downloadedThemeRegistry';
import {
  downloadWallpaper as downloadWallpaperFile,
  isWallpaperDownloaded,
  getWallpaperUri,
  cleanupOrphanedFiles,
} from '@/shared/lib/wallpaperStorage';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import type { ThemePalette } from '@/themes';
import {
  DEFAULT_TOPIC,
  type WallpaperCatalogEntry as SchemaWallpaperEntry,
  type AlbumMeta as SchemaAlbumMeta,
} from '@sovranbitcoin/schemas';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Runtime type for catalog entries. Structurally compatible with
 * `@sovranbitcoin/schemas`' `WallpaperCatalogEntry` — palette is typed more strictly
 * here (the app's `ThemePalette` shade keys) since consumers rely on it.
 */
export interface WallpaperCatalogEntry extends Omit<SchemaWallpaperEntry, 'palette'> {
  palette: ThemePalette;
}

interface DownloadedWallpaper extends WallpaperCatalogEntry {
  localUri: string;
  downloadedAt: number;
}

/**
 * Album metadata with required `topic` (defaulted at ingest to
 * `DEFAULT_TOPIC`) and optional `coverThemeName`. Publishers set `topic` via
 * the admin panel; absent values become `'Other'` so Gallery grouping can
 * rely on the field at the type level.
 */
interface AlbumMeta extends Omit<SchemaAlbumMeta, 'topic' | 'coverThemeName'> {
  topic: string;
  coverThemeName?: string;
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
  downloadWallpaper: (
    entry: WallpaperCatalogEntry,
    onProgress?: (p: number) => void
  ) => Promise<boolean>;
  verifyIntegrity: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Persisted-shape schema (envelope-only validation)
// ---------------------------------------------------------------------------

// Catalog entries and downloaded wallpapers carry rich nested shapes
// (palette + dominantColors + gradientColors). Validate the envelope and
// the identity fields strictly; trust the rest as `unknown` so a single
// malformed entry doesn't drop the whole catalog on rehydrate.
const PersistedCatalogEntry = z.looseObject({
  themeName: z.string().max(64),
  blossomUrl: z.string().max(2048),
  albumSlug: z.string().max(64),
});

const PersistedDownloadedWallpaper = z.looseObject({
  themeName: z.string().max(64),
  blossomUrl: z.string().max(2048),
  albumSlug: z.string().max(64),
  localUri: z.string().max(4096),
  downloadedAt: z.number().int().nonnegative(),
});

const PersistedAlbumMeta = z.looseObject({
  slug: z.string().max(64),
  topic: z.string().max(64),
});

const PersistedWallpaperStore = z.object({
  catalog: z.array(PersistedCatalogEntry).max(10_000).default([]),
  albums: z.array(PersistedAlbumMeta).max(1_000).default([]),
  catalogLastFetched: z.number().int().nonnegative().default(0),
  downloaded: z.record(z.string().max(64), PersistedDownloadedWallpaper).default({}),
});

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
        // Publishers may omit `topic`; default at ingest so downstream
        // grouping code can treat it as required.
        const normalizedAlbums = albums.map((a) => ({
          ...a,
          topic: a.topic?.trim() || DEFAULT_TOPIC,
        }));
        set({
          catalog: wallpapers,
          albums: normalizedAlbums,
          catalogLastFetched: Date.now(),
        });
        storeLog.info('wallpaper.catalog.updated', {
          count: wallpapers.length,
          albums: normalizedAlbums.length,
        });
      },

      downloadWallpaper: async (entry, onProgress) => {
        const { themeName } = entry;

        // Set initial progress
        set((s) => ({
          activeDownloads: { ...s.activeDownloads, [themeName]: 0 },
        }));

        try {
          const localUri = await downloadWallpaperFile(entry.blossomUrl, themeName, (progress) => {
            set((s) => ({
              activeDownloads: { ...s.activeDownloads, [themeName]: progress },
            }));
            onProgress?.(progress);
          });

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
          storeLog.error('wallpaper.download.failed', {
            themeName,
            error: redactError(error),
            url: entry.blossomUrl,
          });

          // Clear progress
          set((s) => {
            const { [themeName]: _, ...rest } = s.activeDownloads;
            return { activeDownloads: rest };
          });

          return false;
        }
      },

      verifyIntegrity: async () => {
        const { downloaded } = get();
        const orphans: string[] = [];
        const normalized: Record<string, DownloadedWallpaper> = {};

        for (const themeName of Object.keys(downloaded)) {
          const expectedUri = getWallpaperUri(themeName);
          const storedUri = downloaded[themeName]?.localUri;
          const exists = await isWallpaperDownloaded(themeName);
          if (!exists) {
            storeLog.warn('wallpaper.integrity.missing', { themeName, storedUri, expectedUri });
            unregisterDownloadedTheme(themeName);
            orphans.push(themeName);
          } else if (storedUri !== expectedUri) {
            normalized[themeName] = { ...downloaded[themeName], localUri: expectedUri };
            registerDownloadedTheme({
              themeName,
              displayName: downloaded[themeName].displayName,
              localUri: expectedUri,
              palette: downloaded[themeName].palette,
              dominantColors: downloaded[themeName].dominantColors,
              gradientColors: downloaded[themeName].gradientColors,
            });
          }
        }

        if (orphans.length > 0 || Object.keys(normalized).length > 0) {
          // Current-profile-only active-theme protection: drop any per-unit
          // overrides pointing at an orphaned theme. Other profiles recover
          // lazily on next load via the resolver fallback.
          const orphanSet = new Set(orphans);
          const themeState = useThemeStore.getState();
          const affectedUnits = Object.entries(themeState.unitWallpapers)
            .filter(([, theme]) => orphanSet.has(theme))
            .map(([unitId]) => unitId);
          const hasAffected = affectedUnits.length > 0;
          const activeAlbumPrimary = themeState.activeAlbumSlug
            ? get()
                .catalog.filter((w) => w.albumSlug === themeState.activeAlbumSlug)
                .sort((a, b) => b.createdAt - a.createdAt)[0]?.themeName
            : undefined;
          const activeAlbumPrimaryMissing =
            !!activeAlbumPrimary && orphanSet.has(activeAlbumPrimary);
          if (hasAffected || activeAlbumPrimaryMissing) {
            storeLog.info('wallpaper.integrity.cleared_theme_refs', {
              affectedUnits,
              activeAlbumSlug: themeState.activeAlbumSlug,
              activeAlbumPrimary,
              activeAlbumPrimaryMissing,
            });
            useThemeStore.setState((prev) => {
              const next: Record<string, string> = {};
              for (const [unitId, theme] of Object.entries(prev.unitWallpapers)) {
                if (!orphanSet.has(theme)) next[unitId] = theme;
              }
              return {
                unitWallpapers: next,
                activeAlbumSlug: activeAlbumPrimaryMissing ? null : prev.activeAlbumSlug,
              };
            });
          }

          // Remove missing files and repair stale absolute file:// paths in store.
          set((s) => {
            const newDownloaded = { ...s.downloaded };
            for (const name of orphans) {
              delete newDownloaded[name];
            }
            for (const [name, wallpaper] of Object.entries(normalized)) {
              newDownloaded[name] = wallpaper;
            }
            return { downloaded: newDownloaded };
          });
        }

        // Clean up files not tracked in store
        const trackedNames = new Set(Object.keys(get().downloaded));
        await cleanupOrphanedFiles(trackedNames);
      },
    }),
    persistConfig({
      name: 'wallpaper-store',
      storage: AsyncStorage,
      schema: PersistedWallpaperStore,
      partialize: (state) => ({
        catalog: state.catalog,
        albums: state.albums,
        catalogLastFetched: state.catalogLastFetched,
        downloaded: state.downloaded,
        // _hasHydrated and activeDownloads are excluded (transient)
      }),
      afterHydrate: (state, error) => {
        if (!error && state?.downloaded) {
          const normalizedDownloaded: Record<string, DownloadedWallpaper> = {};
          for (const [themeName, wallpaper] of Object.entries(state.downloaded)) {
            const localUri = getWallpaperUri(themeName);
            normalizedDownloaded[themeName] = { ...wallpaper, localUri };
            registerDownloadedTheme({
              themeName,
              displayName: wallpaper.displayName,
              localUri,
              palette: wallpaper.palette,
              dominantColors: wallpaper.dominantColors,
              gradientColors: wallpaper.gradientColors,
            });
          }
          useWallpaperStore.setState({ downloaded: normalizedDownloaded });
          storeLog.info('store.wallpaper.rehydrated', {
            downloaded: Object.keys(state.downloaded).length,
            catalog: state.catalog?.length ?? 0,
            normalizedLocalUris: Object.values(state.downloaded).filter(
              (w) => w.localUri !== getWallpaperUri(w.themeName)
            ).length,
          });
          void useWallpaperStore
            .getState()
            .verifyIntegrity()
            .catch((verifyError) => {
              storeLog.warn('wallpaper.integrity.failed', { error: redactError(verifyError) });
            })
            .finally(() => {
              useWallpaperStore.setState({ _hasHydrated: true });
            });
          return;
        }
        useWallpaperStore.setState({ _hasHydrated: true });
      },
    })
  )
);
