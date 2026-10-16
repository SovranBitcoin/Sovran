/**
 * @fileoverview Reading the app's look.
 *
 * `useAppStyle()` returns the look as data (`./registry`).
 *
 * `useStylePaint()` is the one place a style's intent becomes concrete colours
 * and view styles. Components ask it for a surface, a control or a text tone;
 * they never branch on the style and never mix their own grey.
 *
 * Every neutral here is DERIVED from the wallpaper's canvas and foreground —
 * the foreground at a fixed strength over the canvas — rather than read from a
 * palette step. A palette's neighbouring steps can sit two percent apart, which
 * is what used to force a border onto every filled surface; a derived step is
 * the same perceptible distance on every wallpaper, light or dark.
 */

import { useMemo } from 'react';
import type { ViewStyle } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { blend, withAlpha } from '@/shared/lib/color';

import { GLASS } from './registry';
import type { AppStyle } from './types';

/** The app's look. */
export function useAppStyle(): AppStyle {
  return GLASS;
}

/**
 * `withAlpha` for a colour that may not be hex. Theme tokens are hex once the
 * wallpaper's variables are applied, but the library defaults they replace are
 * `oklch()`, and a paint computed in that first frame must not throw.
 */
function tone(color: string, alpha: number): string {
  try {
    return withAlpha(color, alpha);
  } catch {
    return color;
  }
}

// How much foreground is mixed into the canvas for each neutral. One ladder,
// so a raised surface, a pressed control and a divider always keep the same
// order of strength relative to each other.
const STRENGTH = {
  /** Hairline between rows. */
  divider: 0.1,
  /** A tonal surface: the smallest step that reads as a separate plane. */
  surface: 0.07,
  /** A control resting on the canvas or on a surface. */
  control: 0.12,
  /** An outline's stroke. */
  stroke: 0.22,
} as const;

/** Foreground strength for the three text tones. Secondary clears 4.5:1. */
const TEXT = { secondary: 0.66, tertiary: 0.45 } as const;

interface ControlPaint {
  readonly container: ViewStyle;
  /** Icon and label colour inside the container. */
  readonly content: string;
}

interface StylePaint {
  readonly style: AppStyle;
  /** The screen background every neutral is derived against. */
  readonly canvas: string;
  readonly text: {
    readonly primary: string;
    readonly secondary: string;
    readonly tertiary: string;
  };
  readonly divider: string;
  /**
   * A grouped-content frame: fill OR stroke, radius, clipping. No padding.
   * In a `flat` style it is an empty frame — the group sits on the canvas.
   */
  readonly card: ViewStyle;
  /** True when `card` draws nothing, so the caller pads to the gutter only. */
  readonly cardIsBare: boolean;
  /** The one leading action on a screen. */
  readonly primary: ControlPaint;
  /** Every other button. */
  readonly secondary: ControlPaint;
  /** A leading visual: the circle behind a row's icon. */
  readonly chipFill: string;
  /** The resting track of a switch or slider: plainly there, not yet on. */
  readonly track: string;
}

export function useStylePaint(): StylePaint {
  const style = useAppStyle();
  const [foreground, canvas] = useThemeColor(['foreground', 'surface'] as const);

  return useMemo(() => {
    const step = (strength: number) => blend(canvas, foreground, strength);

    // One separation mechanism per style, never two.
    const outlined = style.surface === 'outline';
    const bare = style.surface === 'flat';
    const stroke: ViewStyle = { borderColor: step(STRENGTH.stroke), borderWidth: 1 };

    const card: ViewStyle = {
      borderCurve: 'continuous',
      borderRadius: bare ? 0 : style.radius.card,
      overflow: 'hidden',
      ...(bare ? null : outlined ? stroke : { backgroundColor: step(STRENGTH.surface) }),
    };

    const controlFrame: ViewStyle = { borderCurve: 'continuous', overflow: 'hidden' };

    return {
      style,
      canvas,
      text: {
        primary: foreground,
        secondary: tone(foreground, TEXT.secondary),
        tertiary: tone(foreground, TEXT.tertiary),
      },
      divider: step(STRENGTH.divider),
      card,
      cardIsBare: bare,
      primary: {
        // The primary action: the foreground as the fill, the canvas as the ink.
        container: { ...controlFrame, backgroundColor: foreground },
        content: canvas,
      },
      secondary: {
        container: outlined
          ? { ...controlFrame, ...stroke }
          : { ...controlFrame, backgroundColor: step(STRENGTH.control) },
        content: foreground,
      },
      chipFill: outlined ? 'transparent' : step(STRENGTH.control),
      track: step(STRENGTH.stroke),
    };
  }, [style, foreground, canvas]);
}

/**
 * Fill and stroke for a resting control that is not the primary action: a
 * header circle, the mint selector, a capsule. This is the one definition of
 * that chrome — components spread it over their own geometry and never mix a
 * surface colour with a border colour themselves.
 *
 * The glass style keeps the original pairing (a faint fill with a hairline
 * edge), which is the non-glass fallback of a material that has an edge. Every
 * other style gets its single separation mechanism.
 */
export function useControlChrome(): ViewStyle {
  const paint = useStylePaint();
  const [surfaceSecondary, muted] = useThemeColor(['surface-secondary', 'muted'] as const);
  return useMemo(() => {
    if (paint.style.surface === 'glass') {
      return {
        backgroundColor: surfaceSecondary,
        borderColor: withAlpha(muted, 0.3),
        borderWidth: 1,
      };
    }
    const { backgroundColor, borderColor, borderWidth } = paint.secondary.container;
    return {
      backgroundColor: backgroundColor ?? 'transparent',
      borderColor: borderColor ?? 'transparent',
      borderWidth: borderWidth ?? 0,
    };
  }, [paint, surfaceSecondary, muted]);
}
