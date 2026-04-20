/**
 * Shared draft state across the three theme modals. The user edits a local
 * draft in Preview / Background / Gallery; only **Apply** commits to the
 * store. **Cancel** discards. **Reset** reverts draft to committed state.
 *
 * Stored as a plain Zustand store (NOT persisted) so all three screens —
 * which each mount/unmount as separate routes — share the same pending
 * selection.
 */

import { create } from 'zustand';
import type { UnitId, ThemeName, ThemeMode } from '@/shared/stores/profile/themeStore';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import {
  BUILTIN_COLORS_ALBUM_SLUG,
  BUILTIN_COLOR_THEME_NAMES,
  PROFILE_PRIMARY_UNIT_ID,
} from '@/shared/lib/theme/builtinAlbums';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { log } from '@/shared/lib/logger';

interface ThemeDraftState {
  active: boolean;
  activeAlbumSlug: string | null;
  unitWallpapers: Record<UnitId, ThemeName>;
  mode: ThemeMode;
}

interface ThemeDraftActions {
  /** Start a draft, snapshotting the current themeStore state. */
  beginDraft: (unitIds: UnitId[]) => void;
  /** Replace the album and re-randomise unit wallpapers from its pool. */
  setAlbum: (albumSlug: string, unitIds: UnitId[]) => void;
  /** Override a single unit in the draft. */
  setUnitWallpaper: (unitId: UnitId, theme: ThemeName) => void;
  /** Flip light/dark mode in the draft. */
  setMode: (mode: ThemeMode) => void;
  /**
   * Resolve the theme to render for `unitId`: draft override first, then
   * the main themeStore resolver (which walks album → fallback).
   */
  resolveUnitTheme: (unitId: UnitId) => ThemeName;
  /** Revert draft to committed themeStore state. */
  resetDraft: () => void;
  /** Drop the draft entirely. */
  discard: () => void;
  /** Whether the current draft differs from the committed store state. */
  isDirty: () => boolean;
  /**
   * Commit the draft. Awaits the primary-unit wallpaper download (so the
   * chrome can apply the correct CSS vars before returning), then
   * fire-and-forget the other unit downloads.
   */
  commit: () => Promise<void>;
}

type ThemeDraftStore = ThemeDraftState & ThemeDraftActions;

function snapshotFromStore(): Pick<ThemeDraftState, 'activeAlbumSlug' | 'unitWallpapers' | 'mode'> {
  const s = useThemeStore.getState();
  return {
    activeAlbumSlug: s.activeAlbumSlug,
    unitWallpapers: { ...s.unitWallpapers },
    mode: s.mode,
  };
}

function distributeFromAlbum(
  albumSlug: string,
  unitIds: UnitId[],
): Record<UnitId, ThemeName> {
  const catalog = useWallpaperStore.getState().catalog;
  const pool =
    albumSlug === BUILTIN_COLORS_ALBUM_SLUG
      ? [...BUILTIN_COLOR_THEME_NAMES]
      : catalog
          .filter((w) => w.albumSlug === albumSlug)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((w) => w.themeName);

  if (pool.length === 0 || unitIds.length === 0) {
    log.warn('theme.draft.album_empty', { albumSlug, poolSize: pool.length });
    return {};
  }

  // Take the first N wallpapers (newest-first) and hand one to each unit
  // in order. If the pool is smaller than the unit count, cycle. This is
  // deterministic — same album always produces the same assignment.
  const assigned: Record<UnitId, ThemeName> = {};
  for (let i = 0; i < unitIds.length; i++) {
    assigned[unitIds[i]] = pool[i % pool.length];
  }
  log.info('theme.draft.album_distribute', {
    albumSlug,
    poolSize: pool.length,
    unitCount: unitIds.length,
    assigned,
  });
  return assigned;
}

function equalRecords(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

export const useThemeDraft = create<ThemeDraftStore>((set, get) => ({
  active: false,
  activeAlbumSlug: null,
  unitWallpapers: {},
  mode: 'dark',

  beginDraft: (_unitIds) => {
    // Snapshot verbatim from the store. Do NOT pre-fill resolved defaults
    // for unassigned units — that would immediately mark the draft as dirty
    // (every unit would differ from the store's empty map). Instead, the
    // renderer falls back to the resolver for unset units, and only actual
    // user edits populate the draft.
    const snap = snapshotFromStore();
    set({
      active: true,
      activeAlbumSlug: snap.activeAlbumSlug,
      unitWallpapers: snap.unitWallpapers,
      mode: snap.mode,
    });
  },

  setAlbum: (albumSlug, unitIds) => {
    log.info('theme.draft.set_album', { albumSlug, unitIds });
    const assigned = distributeFromAlbum(albumSlug, unitIds);
    set({ activeAlbumSlug: albumSlug, unitWallpapers: assigned });
  },

  setUnitWallpaper: (unitId, theme) => {
    log.info('theme.draft.set_unit', { unitId, theme });
    set((state) => ({
      unitWallpapers: { ...state.unitWallpapers, [unitId]: theme },
    }));
  },

  setMode: (mode) => {
    log.info('theme.draft.set_mode', { mode });
    set({ mode });
  },

  resolveUnitTheme: (unitId) => {
    const { unitWallpapers } = get();
    if (unitWallpapers[unitId]) return unitWallpapers[unitId];
    return useThemeStore.getState().getUnitWallpaper(unitId);
  },

  resetDraft: () => {
    const snap = snapshotFromStore();
    set({
      activeAlbumSlug: snap.activeAlbumSlug,
      unitWallpapers: snap.unitWallpapers,
      mode: snap.mode,
    });
  },

  discard: () => set({ active: false, activeAlbumSlug: null, unitWallpapers: {}, mode: 'dark' }),

  isDirty: () => {
    const snap = snapshotFromStore();
    const { activeAlbumSlug, unitWallpapers, mode } = get();
    return (
      activeAlbumSlug !== snap.activeAlbumSlug ||
      mode !== snap.mode ||
      !equalRecords(unitWallpapers, snap.unitWallpapers)
    );
  },

  commit: async () => {
    const { activeAlbumSlug, unitWallpapers, mode } = get();
    useThemeStore.setState({
      activeAlbumSlug,
      unitWallpapers,
      mode,
    });

    const wallpaperState = useWallpaperStore.getState();
    const primary = unitWallpapers[PROFILE_PRIMARY_UNIT_ID];

    // Await the primary wallpaper download first so that by the time we
    // call setTheme(primary), `backgroundImageThemes[primary]` is
    // populated by `registerDownloadedTheme` and ThemeProvider's
    // `applyCSSVars` can find the right palette. Otherwise the wallet
    // screen falls back to a solid colour because the image source is
    // still undefined at render time.
    if (primary && !wallpaperState.downloaded[primary]) {
      const entry = wallpaperState.catalog.find((w) => w.themeName === primary);
      if (entry) {
        log.info('theme.commit.primary_download_start', { theme: primary });
        await wallpaperState.downloadWallpaper(entry);
        log.info('theme.commit.primary_download_done', { theme: primary });
      }
    }

    // Fire-and-forget downloads for the other unit wallpapers — they
    // show via the catalog thumb URL until their local files are ready.
    const enqueued = new Set<string>();
    for (const theme of Object.values(unitWallpapers)) {
      if (!theme || theme === primary || enqueued.has(theme)) continue;
      if (wallpaperState.downloaded[theme]) continue;
      const entry = wallpaperState.catalog.find((w) => w.themeName === theme);
      if (!entry) continue;
      enqueued.add(theme);
      void wallpaperState.downloadWallpaper(entry);
    }
    if (enqueued.size > 0) {
      log.info('theme.commit.downloads_enqueued', {
        count: enqueued.size,
        themes: [...enqueued],
      });
    }

    // ThemeProvider now subscribes directly to themeStore — the setState
    // above propagates the new primary wallpaper through the resolver and
    // re-applies CSS vars. No legacy bridge needed.
    set({ active: false, activeAlbumSlug: null, unitWallpapers: {}, mode: 'dark' });
  },
}));
