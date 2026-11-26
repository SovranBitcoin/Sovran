import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { useThemeStore, type ThemeMode } from '@/shared/stores/profile/themeStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { usePresentationUnit } from '@/shared/hooks/usePresentationUnit';
import { useUnitWallpaper } from '@/shared/lib/theme/useUnitWallpaper';
import { THEMES, type ThemeName } from '@/themes';
import { log } from '@/shared/lib/logger';
import { themeVariables, getThemeVariables } from '@/shared/lib/themeEngine';
import {
  coverWallpaperChange,
  isCarouselTheme,
  primeThemeSurface,
  runThemeTransition,
} from '@/shared/lib/theme/themeTransition';
import { isBackgroundImageTheme } from '@/config/backgroundImageThemes';
import { Uniwind } from 'uniwind';

/**
 * The app's chrome theme, owned by the runtime rather than a React context.
 *
 * `useThemeApplier` (mounted once, in `AppRoot`) resolves the theme from the
 * profile-scoped `themeStore`, walks the resolver fallback chain, applies its
 * CSS variables with the right transition, and records the applied name here.
 * `useTheme` reads it anywhere.
 */

let appliedTheme: string | null = null;
const listeners = new Set<() => void>();

function setCurrentTheme(theme: string): void {
  if (appliedTheme === theme) return;
  appliedTheme = theme;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getAppliedTheme = () => appliedTheme;

/**
 * Applies the resolved theme for the whole app. Returns whether the app may
 * render: only once the wallpaper store has registered downloaded themes (so
 * the built-in fallback never flashes) and a theme has been recorded.
 */
export function useThemeApplier(): boolean {
  // Only gate on wallpaperStore — it's a global store and always hydrates.
  // themeStore is profile-scoped and its hydration is gated on
  // `_migrationGate`, which signals AFTER the account scope mounts lower in
  // the tree. Gating on themeStore's load here would deadlock the splash.
  const wallpaperHydrated = useWallpaperStore((s) => s._hasHydrated);
  // The chrome theme follows the ACTIVE WALLET UNIT: switching the wallet to
  // usd applies the wallpaper assigned to usd (unit-scoped assignment inside
  // the profile). Read the persisted unit straight from mintStore — this
  // root mounts above the wallet core, so the coco-aware availability hook
  // isn't reachable here, and the persisted choice is the right key even
  // while coco boots. Falls through resolveUnitWallpaper's chain (unit →
  // album → 'dark') when the unit has no assignment.
  const liveUnit = useMintStore((s) => s.activeUnit);
  const activeUnit = usePresentationUnit(liveUnit);
  const resolvedTheme = useUnitWallpaper(activeUnit);

  // What consumers SEE. On programmatic wallpaper changes it trails
  // `resolvedTheme` until the overlay covers the swap; on carousel-driven
  // changes it applies immediately (the page stack already shows the
  // wallpaper, so there is nothing to hide).
  // A different account under the mounted root needs its theme applied immediately.
  const restartOnProfileSwitch = useSettingsStore((state) => state.restartOnProfileSwitch);
  const accountIndex = useProfileStore((state) =>
    restartOnProfileSwitch ? null : state.activeAccountIndex
  );
  const lastAccount = useRef(accountIndex);
  // Consumers start on the theme resolved at mount, as before the first
  // apply. Once a theme is recorded this never writes again: later themes
  // arrive through the apply below.
  useLayoutEffect(() => {
    if (getAppliedTheme() === null) setCurrentTheme(resolvedTheme);
  }, [resolvedTheme]);
  const lastApplied = useRef<string | null>(null);
  const lastAppliedUnit = useRef<string | null>(null);

  useEffect(() => {
    if (!THEMES[resolvedTheme as ThemeName]) {
      log.warn('theme.not_found', { themeName: resolvedTheme });
      return;
    }
    const accountChanged = lastAccount.current !== accountIndex;
    if (!accountChanged && lastApplied.current === resolvedTheme) {
      lastAppliedUnit.current = activeUnit;
      return;
    }

    const applyVars = () => {
      if (
        (accountIndex !== null && useProfileStore.getState().activeAccountIndex !== accountIndex) ||
        lastApplied.current !== resolvedTheme
      )
        return;
      const t0 = performance.now();
      const vars = themeVariables[resolvedTheme] ?? getThemeVariables(resolvedTheme);
      Uniwind.updateCSSVariables('light', vars);
      Uniwind.updateCSSVariables('dark', vars);
      const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
      log.info('theme.css_vars.applied', {
        theme: resolvedTheme,
        varCount: Object.keys(vars).length,
        duration_ms,
      });
      setCurrentTheme(resolvedTheme);
    };
    const surfaceOf =
      ((themeVariables[resolvedTheme] ?? getThemeVariables(resolvedTheme))['--surface'] as
        string | undefined) ?? null;

    const unitChanged = lastAppliedUnit.current !== activeUnit;
    lastAppliedUnit.current = activeUnit;

    if (lastApplied.current === null || accountChanged) {
      lastAccount.current = accountIndex;
      // Boot apply — no transition, no fade.
      lastApplied.current = resolvedTheme;
      primeThemeSurface(surfaceOf);
      applyVars();
      return;
    }
    const previousTheme = lastApplied.current;
    lastApplied.current = resolvedTheme;
    if (unitChanged && isCarouselTheme(resolvedTheme)) {
      // Unit switch with the account carousel mounted: the wallpaper layer
      // stack already shows (or is animating to) this page's wallpaper —
      // apply the vars right away. No queue, so a rapid drag back can never
      // strand the vars behind an abandoned fade.
      primeThemeSurface(surfaceOf);
      applyVars();
      log.info('theme.transition.carousel_applied', { to: resolvedTheme });
      return;
    }
    if (isBackgroundImageTheme(resolvedTheme)) {
      // Programmatic image-wallpaper change (menu pick / album apply /
      // profile switch): snapshot-cover the outgoing wallpaper, swap the
      // vars under it, and dissolve once a layer underneath has rendered
      // the new image — never dip through the surface color (the dip reads
      // as a flash), and never let the stack re-point in plain sight.
      log.info('theme.transition.start', { to: resolvedTheme, kind: 'cover' });
      coverWallpaperChange(previousTheme, resolvedTheme);
      primeThemeSurface(surfaceOf);
      applyVars();
      return;
    }
    // Color-only target: there is no image to crossfade to — fade the
    // wallpaper layer out, swap at the dip, fade in; the base surface color
    // glides between the themes.
    log.info('theme.transition.start', { to: resolvedTheme, kind: 'fade' });
    runThemeTransition(surfaceOf, applyVars);
  }, [resolvedTheme, activeUnit, accountIndex]);

  const current = useSyncExternalStore(subscribe, getAppliedTheme, getAppliedTheme);
  return wallpaperHydrated && current !== null;
}

export function useTheme(): {
  currentTheme: string;
  mode: ThemeMode;
  availableThemes: ThemeName[];
} {
  const currentTheme = useSyncExternalStore(subscribe, getAppliedTheme, getAppliedTheme);
  const mode = useThemeStore((s) => s.mode);
  return {
    currentTheme: currentTheme ?? 'dark',
    mode,
    availableThemes: Object.keys(THEMES) as ThemeName[],
  };
}
