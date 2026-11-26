import type { ViewProps } from 'react-native';

export type FontWeight =
  | 'ultraLight'
  | 'thin'
  | 'light'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'heavy'
  | 'black';

export type GlassVariant = 'clear' | 'regular';

export type DebugShape =
  | 'none'
  | 'square'
  | 'circle'
  | 'capsule'
  | 'roundedRect'
  | 'textFilled'
  | 'textStroked';

export type LiquidGlassTextProps = {
  text: string;
  /** Registered UIFont name (e.g. "Overpass-Heavy"). Falls back to system font at `fontWeight` when empty/missing. */
  fontName?: string;
  fontSize?: number;
  fontWeight?: FontWeight;
  /** "#RRGGBB". When null, system label color is used. */
  tint?: string | null;
  glassVariant?: GlassVariant;
  interactive?: boolean;
  /**
   * Force the SwiftUI `colorScheme` env value on the hosting controller so the
   * `glassEffect` material renders in the matching mode regardless of the
   * app-window `userInterfaceStyle`. Omit to inherit the system trait.
   */
  colorScheme?: 'light' | 'dark';
  /** Debug override: replace the text glyph shape with a simple custom Path to isolate glass-effect rendering. */
  debugShape?: DebugShape;
  /**
   * iOS 26+: roll the digits that change (up on an increase, down on a
   * decrease) while keeping every glyph a glass cutout. Snaps on mount, on a
   * `formatKey` change and under Reduce Motion. Ignored with a `debugShape`.
   */
  animated?: boolean;
  /** The value behind `text`; its change picks the roll direction. */
  numericValue?: number;
  /** Changes when the same value is shown another way (BTC ↔ sats); snaps. */
  formatKey?: string;
  onLayout?: (e: { nativeEvent: { width: number; height: number } }) => void;
} & ViewProps;

export type LiquidGlassTextNativeModule = {
  isSupported: boolean;
  isLiquidGlassAvailable(): boolean;
};
